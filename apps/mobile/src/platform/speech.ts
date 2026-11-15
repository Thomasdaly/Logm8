import * as Speech from 'expo-speech';
import type { SpeechPort } from '../state/controller';

/** Spoken warnings (the only output while the vehicle is moving). */
export const expoSpeech: SpeechPort = {
  speak: (text) => {
    Speech.stop();
    Speech.speak(text, { language: 'en-AU', rate: 0.95 });
  },
  stop: () => {
    void Speech.stop();
  },
};
