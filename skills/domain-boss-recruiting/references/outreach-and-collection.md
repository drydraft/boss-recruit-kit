# Outreach and collection

> Read this file before the first write to any candidate. General write verification, idempotency, and batch safety belong to `core-safe-batch-operations`; this file fixes the **Boss-specific sequence, wording, acceptance signals, and file naming** that the core skills cannot know.

---

## 1. Sequence

⛔ HARD RULE — run the four writes in this order, per candidate:

```
1. opener            ── one message, one request
2. resume request    ── two-step confirm
3. favourite         ── read state first, then toggle
4. attachment resume ── download, verify header, name deterministically
5. thanks            ── only after a resume actually arrives
```

Never reorder. Never batch one step across all candidates before moving to the next step: identity is verified per candidate, and the panel must be re-confirmed for each write.

## 2. Who gets contacted

| Tier | Contact |
| --- | --- |
| **S** (≥ 70) | yes, first |
| **A** (55–69) | yes |
| **B** (40–54) | only when the operator asks, or when headcount is still open |
| **C / D** | no outreach |

Reject and C/D rows still keep their stage-1 and stage-2 records — they are the audit trail for the rejection reasons.

## 3. Opener

### 3.1 Structure

One sentence of recognition + exactly one request: a PDF resume.

### 3.2 Literal template (candidate-facing; keep verbatim)

```
您好，看到您在 <方向> 方面的经历，和我们 <岗位> 比较匹配。
方便发一份 PDF 简历吗？我这边可以同步看下细节。
```

This is the operator's approved script and the only place in this skill where second-person address is intentional — it is text sent to a candidate, not an instruction to the reader. Replace `<方向>` and `<岗位>` only; change the wording itself only on the operator's instruction.

### 3.3 Do / do not

| Do | Do not |
| --- | --- |
| ask only for 「方便发一份 PDF 简历吗」 | **do not ask about arrival date** — it belongs to the interview stage |
| mention location or budget only when the candidate is out of 大湾区 or over budget | do not open by negotiating salary down |
| keep it readable in one glance | no long paragraphs, no extra links, no attachments |

⛔ HARD RULE — no arrival-date question in the opener. At screening the answer is nearly worthless, while the question measurably raises a candidate's guard and drop-off.

### 3.4 Acceptance signal

The opener counts as sent only when **both** hold: the composer is empty **and** the message is visible in the conversation. A returned success flag is not evidence. If it cannot be confirmed in the conversation, treat it as **not sent** — and then re-read the conversation before retrying, because a message that was actually delivered but not yet rendered must never be sent twice.

## 4. Resume request (two steps)

1. Click 求简历 in the toolbar.
2. In the confirm dialog 「确定向牛人索取简历吗？」 click 确定.
3. ⛔ HARD RULE — accept only when the system message 「**简历请求已发送**」 appears in the conversation. Never accept the function's return value.

## 5. Favourite

⛔ HARD RULE — read the current favourite state **before** clicking. This control toggles: clicking an already-favourited candidate unfavourites them. Skip the click when the state already reads favourited.

## 6. Attachment resume collection

### 6.1 Resolving the real URL

The 附件简历 button opens a preview dialog, not a download. The real address is the `url` query parameter of the PDF-viewer iframe inside that dialog. Resolve it, then hand that resolved URL to the download API; never hand the button's own target.

### 6.2 Verify the bytes

⛔ HARD RULE — after downloading, check that the file starts with `%PDF`. A file that fails the check is a placeholder or an error page, not a resume. Delete it and record the failure; never leave it in the delivery directory.

### 6.3 Naming

```
<序号>_<姓名>.pdf            # default; 序号 = rank by total score
<序号>_<姓名>_<id6>.pdf      # when a name would collide
```

⛔ HARD RULE — never overwrite an existing file. Same-name candidates are common in a large pool, and their resumes differ.

Collision sources to expect: 真重名, placeholder nicknames, and **one person holding several conversations** (different positions, or a repeated greeting). For the multi-conversation case, merge the person into a single list row with the conversation ids comma-separated, and keep one resume file with a note in 备注.

### 6.4 When the button is disabled

A disabled 附件简历 button is usually **not a fault** — the candidate may simply have uploaded no attachment, or the panel may still show the previous candidate. Confirm the panel identity first; if the candidate genuinely has no attachment, record `N/A（仅在线简历）` in the 已收简历 column and let the online-resume screens in the compiled report stand as the material.

## 7. Thanks

Send after the resume arrives:

```
简历已收到，感谢！我这边看完会尽快同步下一步安排。
```

Same two-part acceptance signal as §3.4.

## 8. Cadence

| Parameter | Default |
| --- | --- |
| Interval between two candidates | **15–20 s** |
| Continuous work before a cool-down | **40–60 min** |
| Cool-down length | **30–60 min** |
| First verification round | **3–5 candidates** (proves the pipeline only) |
| Suggested round size | **≤ 30** |

Outreach is the highest-risk phase for throttling, because it interleaves resume reads with writes. Stop the round on the platform's throttle signal (see `platform-notes.md`) instead of retrying.

## 9. Tracking columns

Write these four columns into the list, per candidate, so the operator can see exactly what happened:

| Column | Value |
| --- | --- |
| 已发送 | timestamp, or empty |
| 已收藏 | timestamp, or empty |
| 已收简历 | timestamp + file name, `N/A（仅在线简历）`, or empty |
| 已回复 | timestamp, or empty |

At the end of a round, the count of files in the resume directory must equal the count of rows with a real 已收简历 value. Reconcile before delivering.

## 10. Domain failure signals

| Observation | Domain reading | Action |
| --- | --- | --- |
| Opener typed but conversation unchanged | send did not land | re-read the conversation, then retry once through the fallback order in `platform-notes.md` |
| No 「简历请求已发送」 system message | the second confirm step did not complete | reopen the dialog; do not send a second request blind |
| Candidate already favourited | toggling would remove the favourite | skip and record |
| Downloaded file fails the `%PDF` check | placeholder or error page | delete, record, and mark the row for manual handling |
| Download filename would repeat | name or id collision | add the id suffix; never overwrite |
