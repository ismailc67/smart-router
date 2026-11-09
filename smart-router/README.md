# smart-router

Picks the model and reasoning effort for every prompt automatically, and keeps answers lean to save tokens.

- Quick lookups and small edits go to Haiku at low effort.
- Normal work (content writing, schema, page edits) goes to Sonnet at medium effort.
- Audits, strategy, debugging, research and multi-step builds go to Opus at high effort.
- Subagents are capped at Sonnet/medium. In long chats the model is kept on a downgrade so the prompt cache stays warm; only effort drops.
- A short "be concise" rule is added to the system prompt.

Override one prompt by starting it with `!light`, `!std` or `!deep`. `/route` shows the last pick and token use per tier; `/route auto|off|light|standard|heavy` sets the mode; `/route reset` clears stats.

Install: `/plugin install smart-router --marketplace ismailc67/smart-router`
