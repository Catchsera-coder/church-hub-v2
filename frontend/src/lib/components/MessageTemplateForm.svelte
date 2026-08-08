<script lang="ts">
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    name: initial?.name ?? '',
    channel: (initial?.channel ?? 'email') as 'email' | 'sms' | 'whatsapp',
    subject: (initial?.subject ?? {}) as Record<string, string>,
    header: (initial?.header ?? {}) as Record<string, string>,
    body: (initial?.body ?? {}) as Record<string, string>,
    footer: (initial?.footer ?? {}) as Record<string, string>,
    isActive: initial?.isActive ?? true,
  });
  let error = $state('');
  let saving = $state(false);
  // Merge tokens the backend fills per person at send time (kept as a plain
  // string so the literal braces render, not Svelte expressions).
  const MERGE = '{{firstName}} · {{lastName}} · {{fullName}} · {{churchName}} · {{date}}';

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      if (id) await api(`/message-templates/${id}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/message-templates', { method: 'POST', body: JSON.stringify(form) });
      await goto('/messages/templates');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }

  // --- AI assist (uses the church's configured AI key in Settings → Messaging) ---
  let showAi = $state(false);
  let aiBrief = $state('');
  let aiTone = $state('');
  let aiLoading = $state(false);
  let aiError = $state('');

  async function runAi(brief: string) {
    if (!brief.trim()) return;
    aiLoading = true; aiError = '';
    try {
      const { data } = await api<{ data: any }>('/messages/ai-draft', {
        method: 'POST',
        body: JSON.stringify({ brief: brief.trim(), channels: [form.channel], locales: get(enabledLocales).map((l) => l.code), tone: aiTone.trim() || undefined }),
      });
      const d = data[form.channel];
      if (d) {
        if (form.channel === 'email' && d.subject) form.subject = { ...form.subject, ...d.subject };
        if (d.body) form.body = { ...form.body, ...d.body };
        showAi = false; aiBrief = '';
      }
    } catch (err) { aiError = (err as Error).message; } finally { aiLoading = false; }
  }
  const draftWithAi = () => runAi(aiBrief);
  const improveWithAi = () => runAi(`Improve and correct this message — clearer, warm and pastoral, keep the meaning and any {{merge}} fields:\n\n${form.body.en ?? ''}`);

  // --- SMS/WhatsApp opt-out line (compliance; on by default, editable) ---
  const OPTOUT: Record<string, string> = { en: 'Reply STOP to unsubscribe.', ar: 'أرسل STOP لإلغاء الاشتراك.' };
  let includeOptOut = $state(true);
  const isText = $derived(form.channel === 'sms' || form.channel === 'whatsapp');

  // Add/remove the opt-out line. Called from the checkbox + channel change (not a
  // reactive $effect — that would read+write body and loop).
  function applyOptOut() {
    for (const l of get(enabledLocales)) {
      const line = OPTOUT[l.code] ?? OPTOUT.en;
      const esc = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let b = (form.body[l.code] ?? '').replace(new RegExp(`\\n*${esc}\\s*$`), '').trimEnd();
      if (includeOptOut && (form.channel === 'sms' || form.channel === 'whatsapp')) b = (b ? b + '\n\n' : '') + line;
      form.body[l.code] = b;
    }
  }
</script>

<form class="max-w-2xl space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Template name', ar: 'اسم القالب' }, $locale)}</span>
        <input class="input" bind:value={form.name} required placeholder={tr({ en: 'e.g. Weekly newsletter', ar: 'مثال: النشرة الأسبوعية' }, $locale)} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</span>
        <select class="input" bind:value={form.channel} onchange={applyOptOut}>
          <option value="email">{tr({ en: 'Email', ar: 'بريد إلكتروني' }, $locale)}</option>
          <option value="sms">{tr({ en: 'SMS', ar: 'رسالة نصية' }, $locale)}</option>
          <option value="whatsapp">{tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</option>
        </select>
      </label>
    </div>

    <div class="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      <p class="mb-1 font-medium text-slate-700 dark:text-slate-200">✨ {tr({ en: 'Personalise with merge fields', ar: 'التخصيص بحقول الدمج' }, $locale)}</p>
      <p>{tr({ en: 'Type any of these — each is filled in per person when the message is sent:', ar: 'اكتب أياً منها — يُملأ لكل شخص عند إرسال الرسالة:' }, $locale)}</p>
      <p class="mt-1 font-mono text-slate-700 dark:text-slate-200">{MERGE}</p>
    </div>

    <!-- AI assist -->
    <div class="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600">
      {#if !showAi}
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn-ghost text-sm" onclick={() => { showAi = true; }}>✨ {tr({ en: 'Write with AI', ar: 'اكتب بالذكاء الاصطناعي' }, $locale)}</button>
          {#if form.body.en?.trim()}
            <button type="button" class="btn-ghost text-sm" onclick={improveWithAi} disabled={aiLoading}>{aiLoading ? '…' : '🪄 ' + tr({ en: 'Improve / correct current text', ar: 'تحسين / تصحيح النص الحالي' }, $locale)}</button>
          {/if}
        </div>
        <p class="mt-1 text-xs text-slate-400">{tr({ en: 'Uses your church’s AI key (Settings → Messaging). Review AI text before saving.', ar: 'يستخدم مفتاح الذكاء الاصطناعي لكنيستك (الإعدادات ← المراسلة). راجِع النص قبل الحفظ.' }, $locale)}</p>
      {:else}
        <div class="space-y-2">
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Describe the message you want', ar: 'صف الرسالة التي تريدها' }, $locale)}</span>
            <textarea class="input" rows="2" bind:value={aiBrief} placeholder={tr({ en: 'e.g. A warm birthday greeting mentioning our church', ar: 'مثال: تهنئة عيد ميلاد دافئة تذكر كنيستنا' }, $locale)}></textarea>
          </label>
          <input class="input" bind:value={aiTone} placeholder={tr({ en: 'Tone (optional), e.g. warm and pastoral', ar: 'النبرة (اختياري)' }, $locale)} />
          {#if aiError}<p class="text-xs text-rose-600 dark:text-rose-400">{aiError}</p>{/if}
          <div class="flex gap-2">
            <button type="button" class="btn-primary shrink-0" onclick={draftWithAi} disabled={aiLoading}>{aiLoading ? tr({ en: 'Writing…', ar: 'جارٍ الكتابة…' }, $locale) : tr({ en: 'Generate', ar: 'إنشاء' }, $locale)}</button>
            <button type="button" class="btn-ghost shrink-0" onclick={() => { showAi = false; }}>✕</button>
          </div>
        </div>
      {/if}
    </div>

    {#if form.channel === 'email'}
      {#each $enabledLocales as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Subject', ar: 'الموضوع' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.subject[l.code]} />
        </label>
      {/each}
      {#each $enabledLocales as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Branded header', ar: 'ترويسة' }, $locale)} ({l.native})</span>
          <textarea class="input" dir={l.dir} rows="2" bind:value={form.header[l.code]} placeholder={tr({ en: 'e.g. Grace and peace to you from {{churchName}}', ar: 'مثال: نعمة لكم وسلام من {{churchName}}' }, $locale)}></textarea>
        </label>
      {/each}
    {/if}

    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Body', ar: 'النص' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="5" bind:value={form.body[l.code]} required={l.code === 'en'}></textarea>
      </label>
    {/each}

    {#if isText}
      <div class="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
        <label class="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
          <input type="checkbox" bind:checked={includeOptOut} onchange={applyOptOut} />
          {tr({ en: 'Add an opt-out line (recommended for SMS/WhatsApp)', ar: 'أضف سطر إلغاء الاشتراك (مُوصى به للرسائل النصية/واتساب)' }, $locale)}
        </label>
        <p class="mt-1 text-xs text-amber-700 dark:text-amber-300/90">
          {tr({ en: 'Adds "Reply STOP to unsubscribe." to the end. Many countries require a way to opt out of texts — keep this on unless you have another opt-out in the message.', ar: 'يضيف «أرسل STOP لإلغاء الاشتراك.» في النهاية. تشترط دول كثيرة وجود طريقة لإلغاء الاشتراك — أبقِه مفعّلاً ما لم يكن هناك خيار آخر في الرسالة.' }, $locale)}
        </p>
      </div>
    {/if}

    {#if form.channel === 'email'}
      {#each $enabledLocales as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Branded footer', ar: 'تذييل' }, $locale)} ({l.native})</span>
          <textarea class="input" dir={l.dir} rows="2" bind:value={form.footer[l.code]} placeholder={tr({ en: 'e.g. In Christ, the {{churchName}} team', ar: 'مثال: في المسيح، فريق {{churchName}}' }, $locale)}></textarea>
        </label>
      {/each}
    {/if}

    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active (available when composing)', ar: 'مُفعّل (متاح عند الإنشاء)' }, $locale)}</label>
  </div>

  <p class="text-xs text-slate-500 dark:text-slate-400">
    {tr({ en: 'Templates are reused when composing a message — picking one prefills the subject and body. Header and footer are joined around the body.', ar: 'تُستخدم القوالب عند إنشاء رسالة — اختيار قالب يملأ الموضوع والنص. تُدمج الترويسة والتذييل حول النص.' }, $locale)}
  </p>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/messages/templates">✕</a>
  </div>
</form>
