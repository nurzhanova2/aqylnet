// Does the product's way of disabling thinking actually reach vLLM?
//
// llm.service.ts passes `extra_body: { chat_template_kwargs: … }` to
// openai-node. `extra_body` is a Python-SDK concept; openai-node 6.49 has no
// handling for it, so the key travels literally in the JSON body. Whether it
// then works depends on LiteLLM unpacking it — which can only be observed.
//
// Three requests, same prompt: no flag, the flag at top level (what
// check-llm-model.mjs sends), and the flag inside a literal `extra_body` (what
// the product sends). Thinking shows up as "Thinking Process" text inside
// `content`, because vLLM runs without a reasoning parser here.

import { chat, save, main } from './lib.mjs';

const ASK = [{ role: 'user', content: 'Ответь одним коротким предложением: что такое базовая ставка?' }];
const FLAG = { chat_template_kwargs: { enable_thinking: false } };
const VARIANTS = [
  ['no flag', {}],
  ['top-level chat_template_kwargs', FLAG],
  ['extra_body (as the product sends it)', { extra_body: FLAG }],
];

await main(async () => {
  const rows = [];
  for (const [name, extra] of VARIANTS) {
    const r = await chat({ messages: ASK, max_tokens: 300, temperature: 0, ...extra }, { label: `flag-${name}`, reserve: 400 });
    const thinking = /thinking process|<think>/i.test(r.content) || r.reasoning.length > 0;
    rows.push({ variant: name, status: r.status, completion: r.completion, finish: r.finish, thinking, head: r.content.slice(0, 160) });
    console.log(`${name}: HTTP ${r.status}, completion=${r.completion}, finish=${r.finish}, thinking=${thinking}`);
    console.log(`   ${JSON.stringify(r.content.slice(0, 120))}`);
  }
  save('04-thinking-flag.json', rows);
});
