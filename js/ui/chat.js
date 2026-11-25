/**
 * The Ask tab. With the user's own key, Gemini answers from the same data and
 * plan; without one (or if it fails), the built-in assistant answers.
 */
import {
  MAX_QUESTION_LENGTH,
  askGemini,
  buildSystemPrompt,
  buildUserPrompt,
  localAnswer,
  sanitizeQuestion,
  toPlainLines,
} from '../assistant.js';
import { el, prefersReducedMotion } from '../dom.js';
import { els } from './elements.js';
import { state, T } from './state.js';

function fillMessage(item, role, lines, sourceKey) {
  const meta = role === 'user' ? T('chat.you') : `${T('chat.bot')} · ${T(sourceKey)}`;
  item.replaceChildren(el('p', { class: 'msg-meta', text: meta }), ...lines.map((line) => el('p', { text: line })));
}

function appendMessage(role, lines, sourceKey) {
  const item = el('li', { class: `msg msg-${role}` });
  fillMessage(item, role, lines, sourceKey);
  els.chatLog.append(item);
  item.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  return item;
}

/** Checks the question; returns it cleaned, or null after showing why not. */
function readQuestion() {
  const raw = els.chatInput.value;
  if (raw.trim().length > MAX_QUESTION_LENGTH) {
    els.chatError.textContent = T('chat.tooLong', { n: MAX_QUESTION_LENGTH });
    return null;
  }
  const question = sanitizeQuestion(raw);
  if (!question) {
    els.chatError.textContent = T('chat.empty');
    els.chatInput.focus();
    return null;
  }
  return question;
}

async function answerWithGemini(question, view, builtIn) {
  const pending = appendMessage('bot', [T('chat.thinking')], 'chat.src.gemini');
  els.chatBtn.disabled = true;
  try {
    const answer = await askGemini({
      apiKey: state.ai.apiKey,
      model: state.ai.model,
      systemPrompt: buildSystemPrompt(state.lang),
      userPrompt: buildUserPrompt({
        question,
        place: view.place,
        snapshot: view.snapshot,
        risk: view.risk,
        profile: state.profile,
        plan: view.plan,
        dosDonts: view.dosDonts,
        routinePlan: view.routinePlan,
        translate: T,
      }),
    });
    fillMessage(pending, 'bot', toPlainLines(answer), 'chat.src.gemini');
  } catch (error) {
    const reason = T(`err.${error.code || 'network'}`, error.params || {});
    fillMessage(pending, 'bot', [T('chat.fallback', { reason }), ...builtIn()], 'chat.src.local');
  } finally {
    els.chatBtn.disabled = false;
  }
}

/** Submit of the chat form. */
export async function onAsk(event) {
  event.preventDefault();
  els.chatError.textContent = '';
  const question = readQuestion();
  if (!question) return;

  appendMessage('user', [question]);
  els.chatInput.value = '';

  const view = state.view;
  if (!view) {
    appendMessage('bot', [T('chat.needData')], 'chat.src.local');
    return;
  }
  const builtIn = () =>
    localAnswer({
      question,
      plan: view.plan,
      risk: view.risk,
      translate: T,
      dosDonts: view.dosDonts,
      routinePlan: view.routinePlan,
    }).split('\n');

  if (state.ai.apiKey) await answerWithGemini(question, view, builtIn);
  else appendMessage('bot', builtIn(), 'chat.src.local');
}

/** Enter sends, Shift+Enter makes a new line. */
export function onChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
}

/** Tap on an example question. */
export function onExample(event) {
  const chip = event.target.closest('[data-example]');
  if (!chip) return;
  els.chatInput.value = T(chip.dataset.example);
  els.chatForm.requestSubmit();
}
