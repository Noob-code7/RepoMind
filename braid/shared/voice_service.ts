/**
 * shared/voice_service.ts — Full Voice Engine for Braid CLI.
 * 
 * Features:
 * 1. Microphone recording via Windows MCI (winmm.dll) or native ALSA/sox.
 * 2. Speech-to-Text (STT): ElevenLabs Scribe STT with automatic fallback to Gemini Multimodal Audio.
 * 3. Text-to-Speech (TTS): ElevenLabs Voice Synthesis with the user's Voice ID.
 * 4. Audio Playback: Windows MediaPlayer bridge with instant abort/mute.
 */

import { spawn, execSync, ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from './config.js';

export interface VoiceServiceOptions {
  elevenLabsApiKey?: string;
  voiceId?: string;
  modelId?: string;
  geminiApiKey?: string;
}

export interface MockVoiceHandler {
  record?: () => Promise<string>;
  transcribe?: (audioPath: string) => Promise<string>;
  synthesize?: (text: string) => Promise<Buffer>;
  play?: (audioPath: string) => Promise<void>;
}

let mockVoiceHandler: MockVoiceHandler | null = null;
export function setMockVoiceHandler(handler: MockVoiceHandler | null): void {
  mockVoiceHandler = handler;
}

/** Check if Windows PowerShell is available (WSL2 environment). */
function hasPowerShell(): boolean {
  try {
    execSync('which powershell.exe', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Clean speech input by removing markdown syntax, code fences, and symbols. */
export function sanitizeTextForSpeech(text: string): string {
  let clean = text.trim();
  // Remove fenced code blocks
  clean = clean.replace(/```[\s\S]*?```/g, ' [code snippet omitted] ');
  // Remove inline code
  clean = clean.replace(/`([^`]+)`/g, '$1');
  // Remove images and markdown links
  clean = clean.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  clean = clean.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Remove header hashes, blockquotes, bullets
  clean = clean.replace(/^[#>-]+\s+/gm, '');
  // Remove bold / italics
  clean = clean.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');
  // Remove excessive whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  // Truncate to reasonable speech length if massive
  if (clean.length > 1500) {
    clean = clean.slice(0, 1500) + '... and more.';
  }
  return clean;
}

let activeRecordingProcess: ChildProcess | null = null;
let currentRecordingWavPath: string | null = null;
let activePlaybackProcess: ChildProcess | null = null;

/** Start microphone recording to a WAV file. */
export async function startAudioRecording(outputWavPath?: string): Promise<string> {
  if (mockVoiceHandler?.record) {
    return mockVoiceHandler.record();
  }

  const wavPath = outputWavPath || join(tmpdir(), `braid_rec_${Date.now()}.wav`);
  currentRecordingWavPath = wavPath;

  if (hasPowerShell()) {
    // Windows MCI recording via PowerShell
    // Convert WSL path to Windows path for winmm.dll
    const winPath = wavPath.replace(/^\/tmp\//, '\\\\wsl.localhost\\Ubuntu\\tmp\\').replace(/\//g, '\\');
    
    // Start PowerShell script that opens MCI and begins recording
    const psScript = `
      Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public class MciRecorder {
          [DllImport("winmm.dll", EntryPoint = "mciSendStringA", CharSet = CharSet.Ansi)]
          public static extern int mciSendString(string lpszCommand, string lpszReturnString, int cchReturn, int hwndCallback);
      }
'@
      [MciRecorder]::mciSendString('open new type waveaudio alias recsound', $null, 0, 0) | Out-Null
      [MciRecorder]::mciSendString('record recsound', $null, 0, 0) | Out-Null
      Write-Output "RECORDING_STARTED"
      while ($true) { Start-Sleep -Milliseconds 100 }
    `;

    activeRecordingProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
    return new Promise((resolve, reject) => {
      let started = false;
      activeRecordingProcess?.stdout?.on('data', (d) => {
        if (d.toString().includes('RECORDING_STARTED')) {
          started = true;
          resolve(wavPath);
        }
      });
      activeRecordingProcess?.on('error', (err) => {
        if (!started) reject(err);
      });
      // Safety timeout
      setTimeout(() => {
        if (!started) resolve(wavPath);
      }, 1200);
    });
  }

  // Native Linux recording fallback (arecord / rec)
  activeRecordingProcess = spawn('arecord', ['-f', 'cd', '-t', 'wav', wavPath]);
  return wavPath;
}

/** Stop active microphone recording and return the saved WAV path. */
export async function stopAudioRecording(): Promise<string | null> {
  const wavPath = currentRecordingWavPath;
  if (!wavPath) return null;

  if (activeRecordingProcess) {
    if (hasPowerShell()) {
      const winPath = wavPath.replace(/^\/tmp\//, '\\\\wsl.localhost\\Ubuntu\\tmp\\').replace(/\//g, '\\');
      const stopScript = `
        Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        public class MciRecorder {
            [DllImport("winmm.dll", EntryPoint = "mciSendStringA", CharSet = CharSet.Ansi)]
            public static extern int mciSendString(string lpszCommand, string lpszReturnString, int cchReturn, int hwndCallback);
        }
'@
        [MciRecorder]::mciSendString('stop recsound', $null, 0, 0) | Out-Null
        [MciRecorder]::mciSendString('save recsound "${winPath}"', $null, 0, 0) | Out-Null
        [MciRecorder]::mciSendString('close recsound', $null, 0, 0) | Out-Null
      `;
      try {
        execSync(`powershell.exe -NoProfile -Command "${stopScript.replace(/\n/g, ' ')}"`, { stdio: 'ignore' });
      } catch {
        /* best effort */
      }
    }

    try {
      activeRecordingProcess.kill();
    } catch {
      /* ignore */
    }
    activeRecordingProcess = null;
  }

  currentRecordingWavPath = null;
  return wavPath;
}

/**
 * Transcribe an audio file into text.
 * Attempts ElevenLabs Scribe STT first; automatically falls back to Gemini Multimodal Audio.
 */
export async function transcribeAudio(audioPath: string, opts?: VoiceServiceOptions): Promise<string> {
  if (mockVoiceHandler?.transcribe) {
    return mockVoiceHandler.transcribe(audioPath);
  }

  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const elevenKey = opts?.elevenLabsApiKey || config.elevenLabsApiKey;
  const geminiKey = opts?.geminiApiKey || process.env.GEMINI_API_KEY || config.apiKeyFor('plan');

  // 1. Try ElevenLabs Scribe STT
  if (elevenKey) {
    try {
      const audioBuffer = readFileSync(audioPath);
      const boundary = '----BraidBoundary' + Math.random().toString(36).slice(2);
      const isWav = audioPath.endsWith('.wav');
      const mimeType = isWav ? 'audio/wav' : 'audio/mp3';
      const filename = isWav ? 'recording.wav' : 'recording.mp3';

      const postDataParts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ];
      const part1 = Buffer.from(postDataParts[0]);
      const part2 = Buffer.from(postDataParts[1]);
      const part3 = audioBuffer;
      const part4 = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payload = Buffer.concat([part1, part2, part3, part4]);

      const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: payload,
      });

      if (resp.ok) {
        const json = (await resp.json()) as { text?: string };
        if (json.text && json.text.trim()) {
          return json.text.trim();
        }
      }
    } catch {
      /* Fall through to Gemini STT */
    }
  }

  // 2. High-speed, free Gemini Multimodal Audio fallback
  if (geminiKey) {
    try {
      const audioData = readFileSync(audioPath).toString('base64');
      const isWav = audioPath.endsWith('.wav');
      const mimeType = isWav ? 'audio/wav' : 'audio/mp3';

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType, data: audioData } },
                { text: 'Transcribe the speech in this audio verbatim. Output ONLY the exact transcribed text, no explanations.' },
              ],
            },
          ],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return text;
        }
      }
    } catch (err) {
      throw new Error(`Speech-to-text transcription failed: ${(err as Error).message}`);
    }
  }

  throw new Error('No working speech-to-text provider available. Please check ELEVENLABS_API_KEY or GEMINI_API_KEY.');
}

/** Synthesize text into speech audio using ElevenLabs. */
export async function synthesizeSpeech(text: string, opts?: VoiceServiceOptions): Promise<Buffer> {
  if (mockVoiceHandler?.synthesize) {
    return mockVoiceHandler.synthesize(text);
  }

  const apiKey = opts?.elevenLabsApiKey || config.elevenLabsApiKey;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured in .env');
  }

  const voiceId = opts?.voiceId || config.elevenLabsVoiceId || 'kiaJRdXJzloFWi6AtFBf';
  const modelId = opts?.modelId || config.elevenLabsModelId || 'eleven_multilingual_v2';
  const cleanText = sanitizeTextForSpeech(text);

  if (!cleanText) {
    return Buffer.alloc(0);
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS failed (${resp.status}): ${errText}`);
  }

  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** Play an audio file or buffer through the system speaker. */
export async function playAudio(audioInput: Buffer | string): Promise<void> {
  if (mockVoiceHandler?.play) {
    const p = typeof audioInput === 'string' ? audioInput : 'mock.mp3';
    return mockVoiceHandler.play(p);
  }

  stopAudioPlayback();

  let filePath: string;
  let isTemp = false;

  if (typeof audioInput === 'string') {
    filePath = audioInput;
  } else {
    filePath = join(tmpdir(), `braid_tts_${Date.now()}.mp3`);
    writeFileSync(filePath, audioInput);
    isTemp = true;
  }

  if (hasPowerShell()) {
    const winPath = filePath.replace(/^\/tmp\//, '\\\\wsl.localhost\\Ubuntu\\tmp\\').replace(/\//g, '\\');
    const psScript = `
      Add-Type -AssemblyName presentationCore
      $player = New-Object System.Windows.Media.MediaPlayer
      $player.Open([System.Uri]'${winPath}')
      $player.Play()
      Start-Sleep -Milliseconds 500
      while ($player.NaturalDuration.HasTimeSpan -eq $false) { Start-Sleep -Milliseconds 100 }
      $duration = $player.NaturalDuration.TimeSpan.TotalSeconds
      Start-Sleep -Seconds ([Math]::Ceiling($duration) + 1)
    `;

    return new Promise((resolve) => {
      activePlaybackProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
      activePlaybackProcess.on('exit', () => {
        activePlaybackProcess = null;
        if (isTemp) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
        }
        resolve();
      });
      activePlaybackProcess.on('error', () => {
        activePlaybackProcess = null;
        resolve();
      });
    });
  }

  // Native Linux playback fallback (mpv / ffplay / aplay)
  return new Promise((resolve) => {
    activePlaybackProcess = spawn('mpv', ['--no-video', filePath]);
    activePlaybackProcess.on('exit', () => {
      activePlaybackProcess = null;
      if (isTemp) {
        try { unlinkSync(filePath); } catch { /* ignore */ }
      }
      resolve();
    });
    activePlaybackProcess.on('error', () => {
      activePlaybackProcess = null;
      resolve();
    });
  });
}

/** Stop any actively playing speech audio immediately (mute / abort). */
export function stopAudioPlayback(): void {
  if (activePlaybackProcess) {
    try {
      activePlaybackProcess.kill();
    } catch {
      /* ignore */
    }
    activePlaybackProcess = null;
  }
}
