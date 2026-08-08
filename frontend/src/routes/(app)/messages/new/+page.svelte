<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { get } from 'svelte/store';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let form = $state({
    name: '',
    channel: 'email' as 'email' | 'sms' | 'whatsapp',
    subject: {} as Record<string, string>,
    body: {} as Record<string, string>,
  });
  let error = $state('');
  let saving = $state(false);
  let scheduleAt = $state('');
  const MERGE = '{{firstName}} · {{lastName}} · {{fullName}} · {{churchName}} · {{date}}';

  // Live audience count for the chosen channel = active people opted-in with a
  // matching contact (exactly who a send would reach).
  let audience = $state<number | null>(null);
  $effect(() => {
    const ch = form.channel;
    audience = null;
    api<{ meta: { total: number } }>(`/people?optedIn=${ch}&limit=1`).then((r) => { audience = r.meta.total; }).catch(() => { audience = null; });
  });

  // Branded templates (#20b): pick one to prefill subject + body. Header/footer
  // are joined around the body per language so the branded copy carries through.
  let templates = $state<any[]>([]);
  let templateId = $state<number | ''>('');
  onMount(async () => {
    try { templates = (await api<{ data: any[] }>('/message-templates')).data.filter((x) => x.isActive); } catch { /* templates are optional */ }
  });

  function applyTemplate() {
    const tpl = templates.find((x) => x.id === Number(templateId));
    if (!tpl) return;
    form.channel = tpl.channel;
    const subject: Record<string, string> = {};
    const body: Record<string, string> = {};
    for (const l of get(enabledLocales)) {
      const c = l.code;
      if (tpl.subject?.[c]) subject[c] = tpl.subject[c];
      const parts = [tpl.header?.[c], tpl.body?.[c], tpl.footer?.[c]].filter(Boolean);
      if (parts.length) body[c] = parts.join('\n\n');
    }
    form.subject = { ...form.subject, ...subject };
    form.body = { ...form.body, ...body };
  }

  // AI compose: draft copy from a short brief, fill the form. Off unless a key
  // is configured — the backend replies with a clear message we surface inline.
  let showAi = $state(false);
  let aiBrief = $state('');
  let aiTone = $state('');
  let aiLoading = $state(false);
  let aiError = $state('');

  async function draftWithAi() {
    if (!aiBrief.trim()) return;
    aiLoading = true; aiError = '';
    try {
      const { data } = await api<{ data: any }>('/messages/ai-draft', {
        method: 'POST',
        body: JSON.stringify({
          brief: aiBrief.trim(),
          channels: [form.channel],
          locales: get(enabledLocales).map((l) => l.code),
          tone: aiTone.trim() || undefined,
        }),
      });
      const d = data[form.channel];
      if (d) {
        if (form.channel === 'email' && d.subject) form.subject = { ...form.subject, ...d.subject };
        if (d.body) form.body = { ...form.body, ...d.body };
        showAi = false;
      }
    } catch (err) { aiError = (err as Error).message; } finally { aiLoading = false; }
  }

  async function create(): Promise<number> {
    const { data } = await api<{ data: any }>('/messages', { method: 'POST', body: JSON.stringify(form) });
    return data.id;
  }
  function valid(): boolean {
    if (!form.name.trim()) { error = tr({ en: 'Give the message an internal name.', ar: 'أعطِ الرسالة اسماً داخلياً.' }, $locale); return false; }
    if (!form.body.en?.trim()) { error = tr({ en: 'Write the message body (English).', ar: 'اكتب نص الرسالة (بالإنجليزية).' }, $locale); return false; }
    return true;
  }
  async function saveDraft() {
    if (!valid()) return;
    saving = true; error = '';
    try { await create(); await goto('/messages'); } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
  async function sendNow() {
    if (!valid()) return;
    if (!confirm(tr({ en: `Send now to ${audience ?? 'all matching'} people?`, ar: `إرسال الآن إلى ${audience ?? 'كل المطابقين'} شخص؟` }, $locale))) return;
    saving = true; error = '';
    try {
      const id = await create();
      const { data } = await api<{ data: { sent: number; total: number } }>(`/messages/${id}/send`, { method: 'POST' });
      alert(tr({ en: `Sent to ${data.sent} of ${data.total}.`, ar: `أُرسلت إلى ${data.sent} من ${data.total}.` }, $locale));
      await goto('/messages');
    } catch (err) { error = (err as Error).message; saving = false; }
  }
  async function schedule() {
    if (!valid()) return;
    if (!scheduleAt) { error = tr({ en: 'Pick a date and time to schedule.', ar: 'اختر التاريخ والوقت للجدولة.' }, $locale); return; }
    saving = true; error = '';
    try {
      const id = await create();
      await api(`/messages/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledFor: new Date(scheduleAt).toISOString() }) });
      await goto('/messages');
    } catch (err) { error = (err as Error).message; saving = false; }
  }
</script>

<PageHeader title={tr({ en: 'New message', ar: 'رسالة جديدة' }, $locale)} />

<div class="max-w-2xl space-y-6">
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Internal name', ar: 'اسم داخلي' }, $locale)}</span>
        <input class="input" bind:value={form.name} required placeholder={tr({ en: 'e.g. Sunday reminder', ar: 'مثال: تذكير الأحد' }, $locale)} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</span>
        <select class="input" bind:value={form.channel}>
          <option value="email">{tr({ en: 'Email', ar: 'بريد إلكتروني' }, $locale)}</option>
          <option value="sms">{tr({ en: 'SMS', ar: 'رسالة نصية' }, $locale)}</option>
          <option value="whatsapp">{tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</option>
        </select>
      </label>
    </div>

    {#if templates.length > 0}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Start from template', ar: 'ابدأ من قالب' }, $locale)}</span>
        <select class="input" bind:value={templateId} onchange={applyTemplate}>
          <option value="">{tr({ en: '— None —', ar: '— بدون —' }, $locale)}</option>
          {#each templates as tpl}
            <option value={tpl.id}>{tpl.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <div class="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600">
      {#if !showAi}
        <button type="button" class="btn-ghost text-sm" onclick={() => { showAi = true; }}>
          ✨ {tr({ en: 'Draft with AI', ar: 'صياغة بالذكاء الاصطناعي' }, $locale)}
        </button>
      {:else}
        <div class="space-y-2">
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Describe the message', ar: 'صف الرسالة' }, $locale)}</span>
            <textarea class="input" rows="2" bind:value={aiBrief} placeholder={tr({ en: 'e.g. Remind everyone about Friday prayer meeting at 7pm', ar: 'مثال: ذكّر الجميع باجتماع صلاة الجمعة الساعة 7 مساءً' }, $locale)}></textarea>
          </label>
          <input class="input" bind:value={aiTone} placeholder={tr({ en: 'Tone (optional), e.g. warm and pastoral', ar: 'النبرة (اختياري)' }, $locale)} />
          {#if aiError}<p class="text-xs text-rose-600 dark:text-rose-400">{aiError}</p>{/if}
          <div class="flex gap-2">
            <button type="button" class="btn-primary shrink-0" onclick={draftWithAi} disabled={aiLoading}>{aiLoading ? tr({ en: 'Drafting…', ar: 'جارٍ الصياغة…' }, $locale) : tr({ en: 'Generate', ar: 'إنشاء' }, $locale)}</button>
            <button type="button" class="btn-ghost shrink-0" onclick={() => { showAi = false; }}>✕</button>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Fills subject and body for all languages. Review before saving.', ar: 'يملأ الموضوع والنص لكل اللغات. راجعها قبل الحفظ.' }, $locale)}</p>
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
    {/if}

    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Message', ar: 'الرسالة' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="4" bind:value={form.body[l.code]} required={l.code === 'en'}></textarea>
      </label>
    {/each}

    <div class="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      <p class="mb-1 font-medium text-slate-700 dark:text-slate-200">✨ {tr({ en: 'Personalise with merge fields', ar: 'التخصيص بحقول الدمج' }, $locale)}</p>
      <p class="font-mono text-slate-700 dark:text-slate-200">{MERGE}</p>
    </div>
  </div>

  <!-- Audience + actions -->
  <div class="card space-y-4 p-6">
    <p class="text-sm text-slate-600 dark:text-slate-300">
      {tr({ en: 'Will reach', ar: 'ستصل إلى' }, $locale)}
      <b style="color: var(--brand)">{audience === null ? '…' : audience}</b>
      {tr({ en: 'people opted-in on this channel.', ar: 'شخص موافق على هذه القناة.' }, $locale)}
    </p>

    <div class="flex flex-wrap items-end gap-3">
      <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={saveDraft} disabled={saving}>{saving ? $t('common.loading') : tr({ en: 'Save draft', ar: 'حفظ مسودة' }, $locale)}</button>
      <button class="btn-primary" onclick={sendNow} disabled={saving}>{tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}</button>
      <span class="text-slate-300 dark:text-slate-600">|</span>
      <label class="space-y-1 text-sm">
        <span class="block text-slate-500">{tr({ en: 'Schedule for later', ar: 'جدولة لاحقاً' }, $locale)}</span>
        <input class="input force-ltr" type="datetime-local" bind:value={scheduleAt} />
      </label>
      <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={schedule} disabled={saving || !scheduleAt}>🕐 {tr({ en: 'Schedule', ar: 'جدولة' }, $locale)}</button>
    </div>
    <a class="text-sm text-slate-500 hover:underline" href="/messages">← {tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</a>
  </div>
</div>
