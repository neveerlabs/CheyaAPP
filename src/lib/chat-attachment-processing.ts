import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_SOURCE_BYTES,
} from "./chat-attachments";

export interface ProcessedChatAttachment {
  file: File;
  oversized: boolean;
}

function createFile(blob: Blob, source: File, mimeType: string, extension: string): File {
  const name = source.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${name}.${extension}`, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

async function reencodeVideoWithWebCodecs(file: File): Promise<Blob> {
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
  } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("No video track was found.");
    const duration =
      (await input.getDurationFromMetadata([videoTrack])) ??
      (await input.computeDuration([videoTrack]));
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("The video duration could not be read.");
    }

    const audioTrack = await input.getPrimaryAudioTrack();
    const outputTarget = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target: outputTarget });
    const totalBitrate = Math.floor((MAX_CHAT_ATTACHMENT_BYTES * 8 * 0.78) / duration);
    const videoBitrate = Math.max(
      2_500_000,
      Math.min(12_000_000, totalBitrate - (audioTrack ? 96_000 : 0)),
    );
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: "avc",
        quality: new Quality({ bitrate: videoBitrate, bitrateMode: "variable" }),
        forceTranscode: true,
        hardwareAcceleration: "prefer-hardware",
      },
      ...(audioTrack
        ? {
            audio: {
              codec: "aac" as const,
              quality: new Quality({ bitrate: 96_000, bitrateMode: "variable" }),
              forceTranscode: true,
            },
          }
        : {}),
      tags: await input.getMetadataTags(),
      showWarnings: false,
    });
    const discardedMediaTracks = conversion.discardedTracks.filter(
      ({ track }) => track.type === "video" || track.type === "audio",
    );
    if (!conversion.isValid || discardedMediaTracks.length > 0) {
      throw new Error("This browser cannot decode and encode all required video tracks.");
    }

    await conversion.execute();
    const buffer = outputTarget.buffer;
    if (!buffer?.byteLength) throw new Error("The video converter returned an empty file.");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

export async function preprocessChatAttachment(
  file: File,
  resolvedMimeType = file.type.toLowerCase().split(";")[0].trim(),
): Promise<ProcessedChatAttachment> {
  if (file.size < 1) throw new Error("This file is empty.");
  if (file.size > MAX_CHAT_ATTACHMENT_SOURCE_BYTES) {
    throw new Error(
      `Files must be no larger than ${(MAX_CHAT_ATTACHMENT_SOURCE_BYTES / (1024 * 1024)).toFixed(0)} MB before processing.`,
    );
  }
  if (file.size <= MAX_CHAT_ATTACHMENT_BYTES) {
    return { file, oversized: false };
  }

  const mimeType = resolvedMimeType.toLowerCase().split(";")[0].trim();
  let processedFile = file;
  if (mimeType.startsWith("video/")) {
    const blob = await reencodeVideoWithWebCodecs(file);
    const outputMimeType = blob.type.toLowerCase().split(";")[0];
    const extension = outputMimeType === "video/mp4" ? "mp4" : "webm";
    processedFile = createFile(blob, file, outputMimeType, extension);
  }

  const oversized = processedFile.size > MAX_CHAT_ATTACHMENT_BYTES;
  return { file: oversized ? file : processedFile, oversized };
}
