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

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mimeType, quality),
  );
  if (!blob || blob.type !== mimeType) {
    throw new Error(`This browser cannot safely encode ${mimeType} images.`);
  }
  return blob;
}

function nextGifSubBlockEnd(data: Uint8Array, start: number): number {
  let offset = start;
  while (offset < data.length) {
    const length = data[offset];
    offset += 1;
    if (length === 0) return offset;
    offset += length;
    if (offset > data.length) break;
  }
  throw new Error("This GIF is incomplete and was not uploaded.");
}

async function stripGifMetadata(file: File): Promise<Blob> {
  const data = new Uint8Array(await file.arrayBuffer());
  const signature = new TextDecoder().decode(data.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("This GIF is invalid and was not uploaded.");
  }

  let offset = 13;
  if (data.length < offset) throw new Error("This GIF is incomplete and was not uploaded.");
  const globalColorTable = data[10] & 0x80;
  if (globalColorTable) {
    offset += 3 * (2 ** ((data[10] & 0x07) + 1));
  }
  if (offset > data.length) throw new Error("This GIF is incomplete and was not uploaded.");

  const output = [data.subarray(0, offset)];
  let foundTrailer = false;
  while (offset < data.length) {
    const blockStart = offset;
    const marker = data[offset];
    offset += 1;
    if (marker === 0x3b) {
      output.push(data.subarray(blockStart, offset));
      foundTrailer = true;
      break;
    }
    if (marker === 0x2c) {
      if (offset + 9 > data.length) {
        throw new Error("This GIF is incomplete and was not uploaded.");
      }
      const imagePacked = data[offset + 8];
      offset += 9;
      if (imagePacked & 0x80) {
        offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
      }
      if (offset >= data.length) throw new Error("This GIF is incomplete and was not uploaded.");
      offset += 1;
      offset = nextGifSubBlockEnd(data, offset);
      output.push(data.subarray(blockStart, offset));
      continue;
    }
    if (marker !== 0x21 || offset >= data.length) {
      throw new Error("This GIF contains an unsupported block and was not uploaded.");
    }

    const label = data[offset];
    offset += 1;
    const blockEnd = nextGifSubBlockEnd(data, offset);
    if (![0x01, 0xf9, 0xfe, 0xff].includes(label)) {
      throw new Error("This GIF contains an unsupported extension and was not uploaded.");
    }
    const isGraphicControl = label === 0xf9;
    if (isGraphicControl && data[offset] !== 4) {
      throw new Error("This GIF has an invalid graphics control block and was not uploaded.");
    }
    const isPlainText = label === 0x01;
    let keepBlock = isGraphicControl || isPlainText;
    if (label === 0xff) {
      const appBlockSize = data[offset];
      if (appBlockSize !== 11 || offset + 1 + appBlockSize > blockEnd) {
        throw new Error("This GIF has an invalid application extension and was not uploaded.");
      }
      const appName = new TextDecoder().decode(data.subarray(offset + 1, offset + 1 + appBlockSize));
      keepBlock = appName === "NETSCAPE2.0" || appName === "ANIMEXTS1.0";
    }
    if (keepBlock) output.push(data.subarray(blockStart, blockEnd));
    offset = blockEnd;
  }

  if (!foundTrailer) throw new Error("This GIF is incomplete and was not uploaded.");
  return new Blob(output, { type: "image/gif" });
}

async function sanitizeImage(file: File, mimeType: string): Promise<Blob> {
  if (mimeType === "image/gif") return stripGifMetadata(file);
  const outputMimeType =
    mimeType === "image/heic" || mimeType === "image/heif" ? "image/jpeg" : mimeType;
  if (!["image/jpeg", "image/png", "image/webp"].includes(outputMimeType)) {
    throw new Error(
      "This browser cannot safely sanitize this image format. No file was uploaded.",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser could not decode the image safely. No file was uploaded.");
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image for safe processing.");
    context.drawImage(bitmap, 0, 0);
    return await encodeCanvas(
      canvas,
      outputMimeType,
      outputMimeType === "image/jpeg" ? 0.84 : outputMimeType === "image/webp" ? 0.82 : undefined,
    );
  } finally {
    bitmap.close();
  }
}

function getMediaCaptureStream(media: HTMLMediaElement): MediaStream {
  const mediaWithCapture = media as HTMLMediaElement & {
    captureStream?: () => MediaStream;
    webkitCaptureStream?: () => MediaStream;
  };
  const capture = mediaWithCapture.captureStream ?? mediaWithCapture.webkitCaptureStream;
  if (!capture) {
    throw new Error("This browser cannot safely re-encode this media file. No file was uploaded.");
  }
  return capture.call(media);
}

async function reencodeMedia(file: File, sourceMimeType: string): Promise<Blob> {
  const isVideo = sourceMimeType.startsWith("video/");
  const mimeType = isVideo ? "video/mp4" : "audio/mp4";
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported(mimeType)) {
    throw new Error(
      `This browser cannot create ${mimeType} files, so this media was not uploaded.`,
    );
  }

  const media: HTMLMediaElement = isVideo
    ? document.createElement("video")
    : document.createElement("audio");
  const video = isVideo ? (media as HTMLVideoElement) : null;
  if (video) video.playsInline = true;
  media.preload = "auto";
  media.muted = true;
  const objectUrl = URL.createObjectURL(file);
  media.src = objectUrl;
  let stream: MediaStream | null = null;
  let sourceStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let audioContextResume: Promise<void> | null = null;
  let audioContextResumeError: unknown = null;
  let audioContextStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  try {
    if (window.AudioContext) {
      audioContext = new window.AudioContext();
      audioContextResume = audioContext.resume().catch((error: unknown) => {
        audioContextResumeError = error;
      });
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The media file took too long to open. No file was uploaded.")),
        30_000,
      );
      media.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        if (!Number.isFinite(media.duration) || media.duration <= 0) {
          reject(new Error("This media file has an invalid duration. No file was uploaded."));
          return;
        }
        resolve();
      };
      media.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("This browser could not decode the media file. No file was uploaded."));
      };
      media.load();
    });

    sourceStream = getMediaCaptureStream(media);
    stream = sourceStream;
    if (stream.getAudioTracks().length > 0) {
      if (!audioContext) {
        throw new Error("This browser cannot safely process media audio without playing it aloud.");
      }
      const source = audioContext.createMediaElementSource(media);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      media.muted = false;
      audioContextStream = destination.stream;
      const captureTracks = isVideo
        ? [...sourceStream.getVideoTracks(), ...destination.stream.getAudioTracks()]
        : destination.stream.getAudioTracks();
      stream = new MediaStream(captureTracks);
      await audioContextResume;
      if (audioContextResumeError) {
        throw new Error(
          `The browser could not prepare the video's audio track: ${
            audioContextResumeError instanceof Error
              ? audioContextResumeError.message
              : "audio processing was denied."
          }`,
        );
      }
    } else if (audioContext) {
      await audioContext.close();
      audioContext = null;
      audioContextResume = null;
    }
    const hasRequiredTrack = isVideo
      ? stream.getVideoTracks().length > 0
      : stream.getAudioTracks().length > 0;
    if (!hasRequiredTrack) {
      throw new Error("This browser could not read the media tracks safely. No file was uploaded.");
    }
    if (isVideo && media.duration > 0) {
      const sourceAudioTracks = audioContextStream?.getAudioTracks() ?? [];
      if (audioContextStream && sourceAudioTracks.length === 0) {
        throw new Error("This browser could not preserve the video's audio track. No file was uploaded.");
      }
    }

    recorder = new MediaRecorder(stream, {
      mimeType,
      ...(isVideo
        ? { videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 96_000 }
        : { audioBitsPerSecond: 128_000 }),
    });

    const recording = new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let recordedBytes = 0;
      recorder!.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        chunks.push(event.data);
        recordedBytes += event.data.size;
        if (recordedBytes > MAX_CHAT_ATTACHMENT_BYTES && recorder!.state === "recording") {
          recorder!.stop();
        }
      };
      recorder!.onerror = () =>
        reject(new Error("Media re-encoding failed. No file was uploaded."));
      recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      media.onended = () => {
        if (recorder!.state === "recording") recorder!.stop();
      };
      recorder!.start(500);
      void media.play().catch(() => {
        if (recorder!.state === "recording") recorder!.stop();
        reject(new Error("The browser could not play this media for safe processing."));
      });
    });

    const blob = await recording;
    if (blob.size === 0 || !blob.type.toLowerCase().startsWith(mimeType)) {
      throw new Error("The browser produced an invalid media file. No file was uploaded.");
    }
    return blob;
  } finally {
    if (recorder?.state === "recording") recorder.stop();
    new Set([
      ...(stream?.getTracks() ?? []),
      ...(sourceStream?.getTracks() ?? []),
      ...(audioContextStream?.getTracks() ?? []),
    ]).forEach((track) => track.stop());
    media.pause();
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(objectUrl);
    if (audioContext) await audioContext.close();
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

  const mimeType = resolvedMimeType.toLowerCase().split(";")[0].trim();
  let processedFile = file;
  if (mimeType.startsWith("image/")) {
    const blob = await sanitizeImage(file, mimeType);
    const outputMimeType = blob.type;
    const extension =
      outputMimeType === "image/jpeg"
        ? "jpg"
        : outputMimeType === "image/png"
          ? "png"
          : outputMimeType === "image/gif"
            ? "gif"
            : "webp";
    processedFile = createFile(blob, file, outputMimeType, extension);
  } else if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
    const blob = await reencodeMedia(file, mimeType);
    const outputMimeType = mimeType.startsWith("video/") ? "video/mp4" : "audio/mp4";
    processedFile = createFile(
      blob,
      file,
      outputMimeType,
      mimeType.startsWith("video/") ? "mp4" : "m4a",
    );
  }

  const oversized = processedFile.size > MAX_CHAT_ATTACHMENT_BYTES;
  return { file: oversized ? file : processedFile, oversized };
}
