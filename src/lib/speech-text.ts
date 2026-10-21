export function speechTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speechWordRanges(text: string): Array<{ start: number; end: number }> {
  return Array.from(text.matchAll(/[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*/gu), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export interface SpeechWordTimeline {
  words: Array<{ start: number; end: number }>;
  activity: Uint8Array;
  frameDuration: number;
}

function speechWordWeight(word: string): number {
  const normalized = word.toLowerCase();
  const syllables = normalized.match(/[aeiouyáéíóúàèìòùâêîôûãõ]+/gu)?.length ?? 1;
  return Math.max(1, syllables);
}

export function createSpeechWordTimeline(
  audio: AudioBuffer,
  text: string,
): SpeechWordTimeline | null {
  const words = speechWordRanges(text);
  if (!words.length || !audio.length || !audio.numberOfChannels) return null;

  const frameDuration = 0.02;
  const samplesPerFrame = Math.max(1, Math.round(audio.sampleRate * frameDuration));
  const frameCount = Math.ceil(audio.length / samplesPerFrame);
  const energy = new Float32Array(frameCount);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  let maximumEnergy = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * samplesPerFrame;
    const end = Math.min(audio.length, start + samplesPerFrame);
    let sum = 0;
    for (const samples of channels) {
      for (let sample = start; sample < end; sample += 1) {
        sum += samples[sample] * samples[sample];
      }
    }
    const frameEnergy = Math.sqrt(sum / ((end - start) * audio.numberOfChannels));
    energy[frame] = frameEnergy;
    maximumEnergy = Math.max(maximumEnergy, frameEnergy);
  }

  if (maximumEnergy < 0.008) return null;

  const smoothedEnergy = energy.map((_, index) => {
    const from = Math.max(0, index - 1);
    const to = Math.min(frameCount - 1, index + 1);
    let total = 0;
    for (let frame = from; frame <= to; frame += 1) total += energy[frame];
    return total / (to - from + 1);
  });
  const activityThreshold = Math.max(0.002, maximumEnergy * 0.04);
  const activity = Uint8Array.from(smoothedEnergy, (value) =>
    value >= activityThreshold ? 1 : 0,
  );

  const mergeGapFrames = Math.ceil(0.1 / frameDuration);
  let lastActiveFrame = -1;
  for (let frame = 0; frame < activity.length; frame += 1) {
    if (!activity[frame]) continue;
    if (lastActiveFrame >= 0 && frame - lastActiveFrame <= mergeGapFrames) {
      for (let gap = lastActiveFrame + 1; gap < frame; gap += 1) activity[gap] = 1;
    }
    lastActiveFrame = frame;
  }

  const minimumPeakDistance = Math.max(1, Math.round(0.09 / frameDuration));
  const peakThreshold = Math.max(0.007, maximumEnergy * 0.14);
  const peaks: Array<{ frame: number; energy: number }> = [];
  for (let frame = 1; frame < frameCount - 1; frame += 1) {
    const value = smoothedEnergy[frame];
    if (
      value < peakThreshold ||
      value < smoothedEnergy[frame - 1] ||
      value <= smoothedEnergy[frame + 1]
    ) {
      continue;
    }
    const previousPeak = peaks[peaks.length - 1];
    if (previousPeak && frame - previousPeak.frame < minimumPeakDistance) {
      if (value > previousPeak.energy) peaks[peaks.length - 1] = { frame, energy: value };
      continue;
    }
    peaks.push({ frame, energy: value });
  }

  const syllableWeights = words.map((word) =>
    speechWordWeight(text.slice(word.start, word.end)),
  );
  const totalSyllables = syllableWeights.reduce((sum, weight) => sum + weight, 0);
  if (peaks.length < words.length) return null;

  const selectedPeaks = peaks.length > totalSyllables
    ? peaks
        .slice()
        .sort((left, right) => right.energy - left.energy)
        .slice(0, totalSyllables)
        .sort((left, right) => left.frame - right.frame)
    : peaks;
  const wordPeakRanges: Array<{ first: number; last: number }> = [];
  const extraPeakCount = selectedPeaks.length - words.length;
  const extraSyllableCount = totalSyllables - words.length;
  let cumulativeExtraSyllables = 0;
  for (let index = 0; index < syllableWeights.length; index += 1) {
    const extraSyllables = syllableWeights[index] - 1;
    const firstPeakIndex = index + (
      extraSyllableCount
        ? Math.floor(cumulativeExtraSyllables * extraPeakCount / extraSyllableCount)
        : 0
    );
    const lastPeakIndex = index + Math.floor(
      (cumulativeExtraSyllables + extraSyllables) * extraPeakCount /
        Math.max(1, extraSyllableCount),
    );
    wordPeakRanges.push({
      first: selectedPeaks[firstPeakIndex].frame * frameDuration,
      last: selectedPeaks[Math.max(firstPeakIndex, lastPeakIndex)].frame * frameDuration,
    });
    cumulativeExtraSyllables += extraSyllables;
  }

  const duration = audio.duration;
  const firstActiveFrame = activity.findIndex((value) => value === 1);
  let lastSpeechFrame = activity.length - 1;
  while (lastSpeechFrame >= 0 && !activity[lastSpeechFrame]) lastSpeechFrame -= 1;
  if (firstActiveFrame < 0 || lastSpeechFrame < 0) return null;
  const wordTimings = wordPeakRanges.map((peaks, index) => {
    const previousPeaks = wordPeakRanges[index - 1];
    const nextPeaks = wordPeakRanges[index + 1];
    const start = previousPeaks === undefined
      ? Math.max(0, firstActiveFrame * frameDuration)
      : (previousPeaks.last + peaks.first) / 2;
    const end = nextPeaks === undefined
      ? Math.min(duration, (lastSpeechFrame + 1) * frameDuration)
      : (peaks.last + nextPeaks.first) / 2;
    return { start, end };
  });

  return { words: wordTimings, activity, frameDuration };
}

export function speechWordIndexAtAudioTime(
  timeline: SpeechWordTimeline,
  currentTime: number,
): number | null {
  const frame = Math.floor(currentTime / timeline.frameDuration);
  if (frame < 0 || frame >= timeline.activity.length || !timeline.activity[frame]) return null;
  let low = 0;
  let high = timeline.words.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const word = timeline.words[middle];
    if (currentTime < word.start) {
      high = middle - 1;
    } else if (currentTime >= word.end) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return null;
}

export function speechWordIndexAtProgress(
  text: string,
  progress: number,
): number | null {
  const words = speechWordRanges(text);
  if (!words.length) return null;
  const boundedProgress = Math.min(1, Math.max(0, progress));
  const weights = words.map((word, index) => {
    const wordText = text.slice(word.start, word.end);
    const nextWord = words[index + 1];
    const punctuation = nextWord
      ? text.slice(word.end, nextWord.start)
      : text.slice(word.end);
    const pauseWeight = /[.!?。！？]/u.test(punctuation)
      ? 1.5
      : /[,;:，；：]/u.test(punctuation)
        ? 0.65
        : 0;
    return speechWordWeight(wordText) + pauseWeight;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const targetWeight = totalWeight * boundedProgress;
  let accumulatedWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    accumulatedWeight += weights[index];
    if (targetWeight < accumulatedWeight || index === weights.length - 1) return index;
  }
  return words.length - 1;
}

export function speechWordIndexAtCharacter(text: string, characterIndex: number): number | null {
  const words = speechWordRanges(text);
  if (!words.length) return null;
  const index = words.findIndex((word) => characterIndex < word.end);
  return index < 0 ? words.length - 1 : index;
}
