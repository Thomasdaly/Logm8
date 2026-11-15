import * as Crypto from 'expo-crypto';
import type { Hasher } from '../lib/hash';

export const sha256: Hasher = (input) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
