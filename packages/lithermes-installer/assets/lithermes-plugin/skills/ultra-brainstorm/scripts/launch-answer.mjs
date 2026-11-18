#!/usr/bin/env node
// Reads the user's reply to the launch question and says what it means. The reply arrives ONLY on
// stdin, from a quoted heredoc, so nothing in it is ever expanded or run by a shell:
//
//   node <skill-root>/scripts/launch-answer.mjs <<'LIT_REPLY_END_9Q7'
//   <the user's reply, unchanged>
//   LIT_REPLY_END_9Q7
//
// It takes no arguments; any argument is an error (exit 64). It prints one JSON line:
//   {"answer":"launch","children":N}   one count, from a typed number or a picked option's label
//   {"answer":"stop"}                  a plain no: the run ends here, nothing is asked again
//   {"answer":"ask","reason":"..."}    anything else: no count, two counts, a question, out of range
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MAX_CHILDREN } from './estimate.mjs';

export const REPLY_DELIMITER = 'LIT_REPLY_END_9Q7';
const MAX_REPLY_BYTES = 4096;
const NO = /^(?:no|nope|nah|n|stop|cancel|don'?t|do not|never ?mind|아니|아니요|아니오|아뇨|싫어|안 ?해|그만|취소|됐어)$/u;

/** The meaning of one reply text. Pure; the caller decides what to do with it. */
export const readLaunchAnswer = (reply) => {
  const text = String(reply ?? '').normalize('NFKC').trim();
  if (!text) return { answer: 'ask', reason: 'no reply' };
  const plain = text.toLowerCase().replace(/[\s.!。]+$/u, '').replace(/\s+/gu, ' ');
  if (NO.test(plain)) return { answer: 'stop' };
  if (text.includes('?') || text.includes('？')) return { answer: 'ask', reason: 'the reply is a question' };
  // Thousands separators are part of one number: "1,000" is one count.
  const counts = [...new Set((text.replace(/(\d),(?=\d{3}\b)/gu, '$1').match(/\d+/gu) ?? []).map(Number))];
  if (counts.length === 0) return { answer: 'ask', reason: 'the reply names no count' };
  if (counts.length > 1) return { answer: 'ask', reason: 'the reply names more than one count' };
  const [children] = counts;
  if (children < 1 || children > MAX_CHILDREN) return { answer: 'ask', reason: `the count must be 1 to ${MAX_CHILDREN}` };
  return { answer: 'launch', children };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) {
    process.stderr.write('launch-answer: takes no arguments; pass the reply on stdin through a quoted heredoc\n');
    process.exitCode = 64;
  } else {
    let raw = '';
    try {
      raw = readFileSync(0).subarray(0, MAX_REPLY_BYTES).toString('utf8');
    } catch {
      raw = '';
    }
    process.stdout.write(`${JSON.stringify(readLaunchAnswer(raw))}\n`);
  }
}
