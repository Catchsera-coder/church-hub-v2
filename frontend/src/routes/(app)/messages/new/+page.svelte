<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { get } from 'svelte/store';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ScheduleEditor from '$lib/components/ScheduleEditor.svelte';
  import { type Schedule, defaultSchedule, describeSchedule } from '$lib/schedule.js';
  import { resolveStreamLink } from '$lib/stream.js';

  let form = $state({
    name: '',
    channel: 'email' as 'email' | 'sms' | 'whatsapp',
    subject: {} as Record<string, string>,
    body: {} as Record<string, string>,
    mediaUrl: null as string | null,
    // Optional email call-to-action button (label per language + a link).
    ctaLabel: {} as Record<string, string>,
    ctaUrl: '' as string,
  });
  let error = $state('');
  let saving = $state(false);

  // Custom variables: {{speaker}}, {{link}} etc. (anything that isn't a per-person
  // field) — filled once for the whole message and substituted before sending.
  const PERSON_VARS = new Set(['firstName', 'lastName', 'fullName', 'churchName', 'date']);
  let customValues = $state<Record<string, string>>({});
  const customVars = $derived.by(() => {
    const text = [...Object.values(form.subject), ...Object.values(form.body)].join(' ');
    const found = new Set<string>();
    for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!PERSON_VARS.has(m[1])) found.add(m[1]);
    return [...found];
  });
  function fillCustom(text: string): string {
    return (text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, k: string) => (PERSON_VARS.has(k) ? whole : (customValues[k] ?? whole)));
  }
  function filledForm() {
    const subject: Record<string, string> = {}; const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(form.subject)) subject[k] = fillCustom(v);
    for (const [k, v] of Object.entries(form.body)) body[k] = fillCustom(v);
    const ctaLabel: Record<string, string> = {};
    for (const [k, v] of Object.entries(form.ctaLabel)) if (v?.trim()) ctaLabel[k] = fillCustom(v);
    // Only send a CTA on email when both a label and a link are present.
    const hasCta = form.channel === 'email' && Object.keys(ctaLabel).length > 0 && form.ctaUrl.trim();
    return { ...form, subject, body, ctaLabel: hasCta ? ctaLabel : null, ctaUrl: hasCta ? form.ctaUrl.trim() : null, audience: currentAudience() };
  }

  // --- Recipients: everyone opted-in, ministries/groups, a dynamic segment, a
  // chosen subset, or a single person/number.
  type RecipMode = 'all' | 'ministries' | 'segment' | 'people' | 'one';
  let recipMode = $state<RecipMode>('all');
  let peopleList = $state<any[]>([]);
  let peopleSearch = $state('');
  let selectedIds = $state<Set<number>>(new Set());
  let onePersonId = $state<number | null>(null);
  let oneContact = $state('');

  // Ministries & groups targeting (dynamic — resolves to the current roster at send).
  let allMinistries = $state<any[]>([]);
  let selectedMinistryIds = $state<Set<number>>(new Set());
  function toggleMinistry(id: number) { const s = new Set(selectedMinistryIds); if (s.has(id)) s.delete(id); else s.add(id); selectedMinistryIds = s; }
  onMount(async () => {
    try { allMinistries = (await api<{ data: any[] }>('/ministries')).data; } catch { /* optional */ }
  });

  // Segment targeting (dynamic — reuses the Members filters).
  const MONTHS = [
    { v: 1, en: 'January', ar: 'يناير' }, { v: 2, en: 'February', ar: 'فبراير' }, { v: 3, en: 'March', ar: 'مارس' },
    { v: 4, en: 'April', ar: 'أبريل' }, { v: 5, en: 'May', ar: 'مايو' }, { v: 6, en: 'June', ar: 'يونيو' },
    { v: 7, en: 'July', ar: 'يوليو' }, { v: 8, en: 'August', ar: 'أغسطس' }, { v: 9, en: 'September', ar: 'سبتمبر' },
    { v: 10, en: 'October', ar: 'أكتوبر' }, { v: 11, en: 'November', ar: 'نوفمبر' }, { v: 12, en: 'December', ar: 'ديسمبر' },
  ];
  let seg = $state<Record<string, string>>({ status: '', ageGroup: '', birthdayMonth: '', ministryId: '', inactiveWeeks: '' });
  const segmentObj = $derived.by(() => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(seg)) if (v !== '') o[k] = v;
    return o;
  });

  // The audience spec for the current mode (null = everyone opted-in).
  function currentAudience(): any {
    if (recipMode === 'people') return { mode: 'people', personIds: [...selectedIds] };
    if (recipMode === 'ministries') return { mode: 'ministries', ministryIds: [...selectedMinistryIds] };
    if (recipMode === 'segment') return { mode: 'segment', segment: segmentObj };
    return null; // 'all'
  }
  async function searchPeople() {
    const q = peopleSearch.trim();
    try {
      const r = await api<{ data: any[] }>(`/people?optedIn=${form.channel}&limit=50${q ? `&search=${encodeURIComponent(q)}` : ''}`);
      peopleList = r.data;
    } catch { peopleList = []; }
  }
  function toggleId(id: number) { const s = new Set(selectedIds); if (s.has(id)) s.delete(id); else s.add(id); selectedIds = s; }
  function selectAllShown() { const s = new Set(selectedIds); for (const p of peopleList) s.add(p.id); selectedIds = s; }
  const personName = (p: any) => tr(p.givenName ?? {}, $locale) + ' ' + tr(p.familyName ?? {}, $locale);

  // --- Preview (all channels)
  let previewOpen = $state(false);
  let previewData = $state<any>(null);
  let previewing = $state(false);
  async function preview() {
    previewOpen = true; previewData = null; previewing = true;
    try {
      const f = filledForm();
      const { data } = await api<{ data: any }>('/messages/preview', { method: 'POST', body: JSON.stringify({
        channel: form.channel, subject: form.subject, body: f.body, ctaLabel: f.ctaLabel, ctaUrl: f.ctaUrl,
      }) });
      previewData = data;
    } catch (err) { previewData = { error: (err as Error).message }; } finally { previewing = false; }
  }

  // --- Quick send to a single member or an ad-hoc phone/email
  async function quickSend() {
    if (!valid()) return;
    if (!onePersonId && !oneContact.trim()) { error = tr({ en: 'Pick a person or type a number/email.', ar: 'اختر شخصاً أو اكتب رقماً/بريداً.' }, $locale); return; }
    saving = true; error = '';
    try {
      const f = filledForm();
      const { data } = await api<{ data: { ok: boolean; to: string } }>('/messages/quick-send', { method: 'POST', body: JSON.stringify({
        channel: form.channel, toPersonId: onePersonId, toContact: onePersonId ? null : oneContact.trim(),
        subject: f.subject, body: f.body, ctaLabel: f.ctaLabel, ctaUrl: f.ctaUrl, mediaUrl: form.mediaUrl,
      }) });
      alert(data.ok ? tr({ en: `Sent to ${data.to}.`, ar: `أُرسلت إلى ${data.to}.` }, $locale) : tr({ en: 'Send failed — check messaging settings.', ar: 'فشل الإرسال — تحقق من الإعدادات.' }, $locale));
      if (data.ok) await goto('/messages');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }

  // --- Recurring schedule (reuses the shared engine)
  let showRecurring = $state(false);
  let sched = $state<Schedule>(defaultSchedule());
  async function scheduleRecurring() {
    if (!valid()) return;
    saving = true; error = '';
    try {
      const id = await create();
      await api(`/messages/${id}/schedule`, { method: 'POST', body: JSON.stringify({ schedule: sched }) });
      await goto('/messages');
    } catch (err) { error = (err as Error).message; saving = false; }
  }

  // Image upload (MMS/WhatsApp)
  let uploading = $state(false);
  async function onImage(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) { error = tr({ en: 'Use a JPEG, PNG or GIF.', ar: 'استخدم JPEG أو PNG أو GIF.' }, $locale); return; }
    if (file.size > 5 * 1024 * 1024) { error = tr({ en: 'Image must be under 5 MB.', ar: 'يجب أن تكون الصورة أقل من 5 ميجابايت.' }, $locale); return; }
    uploading = true; error = '';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { data } = await api<{ data: { url: string } }>('/media', { method: 'POST', body: JSON.stringify({ base64: reader.result, contentType: file.type, filename: file.name }) });
        form.mediaUrl = data.url;
      } catch (err) { error = (err as Error).message; } finally { uploading = false; }
    };
    reader.readAsDataURL(file);
  }
  let scheduleAt = $state('');
  const MERGE = '{{firstName}} · {{lastName}} · {{fullName}} · {{churchName}} · {{date}}';

  // Live "will reach N" for the chosen channel + audience: exactly who a send
  // would reach (active, opted-in, contactable). Recomputes as the audience or
  // channel changes; debounced so typing filters doesn't spam the server.
  let reachCount = $state<number | null>(null);
  let reachTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const ch = form.channel;
    const mode = recipMode;
    const aud = currentAudience(); // reads selectedIds / selectedMinistryIds / segmentObj → tracked
    if (mode === 'one') { reachCount = null; return; }
    reachCount = null;
    clearTimeout(reachTimer);
    reachTimer = setTimeout(() => {
      api<{ data: { count: number } }>('/messages/audience-count', { method: 'POST', body: JSON.stringify({ channel: ch, audience: aud }) })
        .then((r) => { reachCount = r.data.count; }).catch(() => { reachCount = null; });
    }, 250);
  });

  // Branded templates (#20b): pick one to prefill subject + body. Header/footer
  // are joined around the body per language so the branded copy carries through.
  let templates = $state<any[]>([]);
  let templateId = $state<number | ''>('');
  onMount(async () => {
    try { templates = (await api<{ data: any[] }>('/message-templates')).data.filter((x) => x.isActive); } catch { /* templates are optional */ }
  });

  // Ministry stream links: insert a "Watch live" link that auto-points to the
  // current live stream (YouTube /live), or a fixed URL.
  let ministries = $state<any[]>([]);
  let streamMinistryId = $state<number | ''>('');
  onMount(async () => {
    try { ministries = (await api<{ data: any[] }>('/ministries')).data.filter((m) => resolveStreamLink(m.streaming)); } catch { /* optional */ }
  });
  // Pre-select recipients from a ?people=1,2,3 deep link (e.g. "Message this family").
  onMount(() => {
    const p = get(page).url.searchParams.get('people');
    if (!p) return;
    const ids = p.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) { recipMode = 'people'; selectedIds = new Set(ids); searchPeople(); }
  });

  function insertStreamLink() {
    const m = ministries.find((x) => x.id === Number(streamMinistryId));
    const link = m && resolveStreamLink(m.streaming);
    if (!link) return;
    for (const l of get(enabledLocales)) {
      const c = l.code;
      const label = c === 'ar' ? 'شاهد البث المباشر' : 'Watch live';
      form.body[c] = (form.body[c] ? form.body[c] + '\n\n' : '') + `${label}: ${link}`;
    }
    if (form.channel === 'email') { if (!form.ctaLabel.en?.trim()) form.ctaLabel.en = 'Watch live'; form.ctaUrl = link; }
  }

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
    const { data } = await api<{ data: any }>('/messages', { method: 'POST', body: JSON.stringify(filledForm()) });
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
    if (recipMode === 'people' && selectedIds.size === 0) { error = tr({ en: 'Select at least one person.', ar: 'اختر شخصاً واحداً على الأقل.' }, $locale); return; }
    if (recipMode === 'ministries' && selectedMinistryIds.size === 0) { error = tr({ en: 'Choose at least one ministry or group.', ar: 'اختر خدمة أو مجموعة واحدة على الأقل.' }, $locale); return; }
    if (reachCount === 0) { error = tr({ en: 'This audience reaches no one on this channel (no opted-in contacts).', ar: 'هذا الجمهور لا يصل لأحد على هذه القناة (لا توجد جهات موافِقة).' }, $locale); return; }
    const count = reachCount ?? tr({ en: 'all matching', ar: 'كل المطابقين' }, $locale);
    if (!confirm(tr({ en: `Send now to ${count} people?`, ar: `إرسال الآن إلى ${count} شخص؟` }, $locale))) return;
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
      <p class="mt-1">{tr({ en: 'Add your own like {{speaker}} or {{link}} — you’ll fill those in below.', ar: 'أضف حقولك مثل {{speaker}} أو {{link}} — ستملؤها بالأسفل.' }, $locale)}</p>
    </div>

    {#if customVars.length}
      <div class="rounded-lg border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-800 dark:bg-primary-900/10">
        <p class="mb-2 text-sm font-medium">{tr({ en: 'Fill in the details', ar: 'املأ التفاصيل' }, $locale)}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each customVars as v}
            <label class="text-sm"><span class="mb-1 block font-mono text-xs text-slate-500">{'{{' + v + '}}'}</span><input class="input" bind:value={customValues[v]} placeholder={v} /></label>
          {/each}
        </div>
      </div>
    {/if}

    {#if form.channel === 'sms' || form.channel === 'whatsapp'}
      <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p class="mb-1 text-sm font-medium">🖼 {tr({ en: 'Add an image (optional)', ar: 'أضف صورة (اختياري)' }, $locale)}</p>
        <p class="mb-2 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Sent as MMS (SMS) or media (WhatsApp). JPEG/PNG/GIF, under 5 MB. Note: MMS needs an MMS-capable number and may cost more.', ar: 'تُرسل كـ MMS (SMS) أو وسائط (واتساب). JPEG/PNG/GIF أقل من 5 ميجابايت. ملاحظة: يتطلب MMS رقماً يدعمه وقد تزيد التكلفة.' }, $locale)}</p>
        {#if form.mediaUrl}
          <div class="flex items-center gap-3"><img src={form.mediaUrl} alt="" class="h-16 w-16 rounded object-cover" /><button type="button" class="text-xs text-rose-600 hover:underline" onclick={() => (form.mediaUrl = null)}>{tr({ en: 'Remove', ar: 'إزالة' }, $locale)}</button></div>
        {:else}
          <label class="btn-ghost inline-block cursor-pointer border border-slate-300 text-sm dark:border-slate-700">{uploading ? $t('common.loading') : tr({ en: 'Choose image', ar: 'اختر صورة' }, $locale)}<input type="file" accept="image/jpeg,image/png,image/gif" class="hidden" onchange={onImage} /></label>
        {/if}
      </div>
    {/if}

    {#if form.channel === 'email'}
      <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p class="mb-1 text-sm font-medium">🔘 {tr({ en: 'Call-to-action button (optional)', ar: 'زر إجراء (اختياري)' }, $locale)}</p>
        <p class="mb-2 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'A branded button in the email — e.g. “View this Sunday” linking to your website or a form.', ar: 'زر مميز في البريد — مثل «تفاصيل هذا الأحد» يربط بموقعك أو نموذج.' }, $locale)}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Button text (English)', ar: 'نص الزر (إنجليزي)' }, $locale)}</span><input class="input" bind:value={form.ctaLabel.en} placeholder="View this Sunday" /></label>
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Link URL', ar: 'الرابط' }, $locale)}</span><input class="input force-ltr" bind:value={form.ctaUrl} placeholder="https://…" /></label>
        </div>
        {#if $enabledLocales.some((l) => l.code === 'ar')}
          <label class="mt-2 block text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Button text (Arabic)', ar: 'نص الزر (عربي)' }, $locale)}</span><input class="input" dir="rtl" bind:value={form.ctaLabel.ar} /></label>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Audience + actions -->
  {#if ministries.length}
    <div class="card space-y-2 p-6">
      <p class="text-sm font-medium">📺 {tr({ en: "Insert a ministry's live-stream link", ar: 'أدرج رابط بث خدمة' }, $locale)}</p>
      <div class="flex flex-wrap items-center gap-2">
        <select class="input max-w-xs" bind:value={streamMinistryId}>
          <option value="">{tr({ en: '— Choose a ministry —', ar: '— اختر خدمة —' }, $locale)}</option>
          {#each ministries as m}<option value={m.id}>{tr(m.name, $locale)}</option>{/each}
        </select>
        <button type="button" class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" disabled={!streamMinistryId} onclick={insertStreamLink}>{tr({ en: 'Insert link', ar: 'إدراج الرابط' }, $locale)}</button>
      </div>
      <p class="text-xs text-slate-400">{tr({ en: 'Adds a "Watch live" link (and the email button). The link always points to the current stream — great with a recurring weekly send.', ar: 'يضيف رابط «شاهد البث» (وزر البريد). يشير الرابط دائماً إلى البث الحالي — رائع مع الإرسال الأسبوعي المتكرر.' }, $locale)}</p>
    </div>
  {/if}

  <div class="card space-y-4 p-6">
    <!-- Recipients -->
    <div class="space-y-2">
      <p class="text-sm font-medium">{tr({ en: 'Who receives it', ar: 'من يستلمها' }, $locale)}</p>
      <div class="flex flex-wrap gap-2">
        {#each [{ v: 'all', l: { en: 'Everyone opted-in', ar: 'كل الموافقين' } }, { v: 'ministries', l: { en: 'Ministries & groups', ar: 'الخدمات والمجموعات' } }, { v: 'segment', l: { en: 'Segment (filters)', ar: 'شريحة (تصفية)' } }, { v: 'people', l: { en: 'Choose people', ar: 'اختر أشخاصاً' } }, { v: 'one', l: { en: 'One person / number', ar: 'شخص / رقم واحد' } }] as opt}
          <button type="button" class="rounded-md border px-3 py-1.5 text-sm {recipMode === opt.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={recipMode === opt.v ? 'background: var(--brand)' : ''} onclick={() => { recipMode = opt.v as RecipMode; if ((opt.v === 'people' || opt.v === 'one') && !peopleList.length) searchPeople(); }}>{tr(opt.l, $locale)}</button>
        {/each}
      </div>

      <!-- Live reach for every audience mode except the ad-hoc single send -->
      {#if recipMode !== 'one'}
        <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Will reach', ar: 'ستصل إلى' }, $locale)} <b style="color: var(--brand)">{reachCount === null ? '…' : reachCount}</b> {tr({ en: 'people opted-in on this channel.', ar: 'شخص موافق على هذه القناة.' }, $locale)}</p>
      {/if}

      {#if recipMode === 'all'}
        <p class="text-xs text-slate-400">{tr({ en: 'Everyone active who opted in to this channel.', ar: 'كل نشط موافق على هذه القناة.' }, $locale)}</p>
      {:else if recipMode === 'ministries'}
        <p class="text-xs text-slate-400">{tr({ en: 'Send to the current members of the chosen teams/groups (leaders + volunteers). Great for a recurring send — it always uses the latest roster.', ar: 'أرسل إلى أعضاء الفرق/المجموعات المختارة الحاليين. رائع للإرسال المتكرر — يستخدم دائماً أحدث قائمة.' }, $locale)}</p>
        <div class="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          {#each allMinistries as m (m.id)}
            <label class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <input type="checkbox" checked={selectedMinistryIds.has(m.id)} onchange={() => toggleMinistry(m.id)} />
              <span>{m.kind === 'group' ? '🏡' : '🙌'} {tr(m.name, $locale)}</span>
              <span class="ms-auto text-xs text-slate-400">{m.memberCount ?? 0} {tr({ en: 'members', ar: 'أعضاء' }, $locale)}</span>
            </label>
          {:else}
            <p class="px-2 py-1 text-xs text-slate-400">{tr({ en: 'No ministries or groups yet.', ar: 'لا توجد خدمات أو مجموعات بعد.' }, $locale)}</p>
          {/each}
        </div>
        {#if selectedMinistryIds.size}<p class="text-xs font-medium" style="color: var(--brand)">{selectedMinistryIds.size} {tr({ en: 'selected', ar: 'محدد' }, $locale)}</p>{/if}
      {:else if recipMode === 'segment'}
        <p class="text-xs text-slate-400">{tr({ en: 'Build a live audience from filters — anyone matching is included at send time.', ar: 'ابنِ جمهوراً حياً من عوامل التصفية — يُضمَّن كل مطابق وقت الإرسال.' }, $locale)}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
            <select class="input" bind:value={seg.status}><option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option><option value="visitor">{tr({ en: 'Visitor', ar: 'زائر' }, $locale)}</option><option value="regular">{tr({ en: 'Regular', ar: 'منتظم' }, $locale)}</option><option value="member">{tr({ en: 'Member', ar: 'عضو' }, $locale)}</option></select>
          </label>
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Age group', ar: 'الفئة العمرية' }, $locale)}</span>
            <select class="input" bind:value={seg.ageGroup}><option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option><option value="child">{tr({ en: 'Children', ar: 'أطفال' }, $locale)}</option><option value="youth">{tr({ en: 'Youth', ar: 'شباب' }, $locale)}</option><option value="adult">{tr({ en: 'Adults', ar: 'بالغون' }, $locale)}</option></select>
          </label>
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">🎂 {tr({ en: 'Birthday month', ar: 'شهر الميلاد' }, $locale)}</span>
            <select class="input" bind:value={seg.birthdayMonth}><option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>{#each MONTHS as mo}<option value={mo.v}>{tr({ en: mo.en, ar: mo.ar }, $locale)}</option>{/each}</select>
          </label>
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'In ministry', ar: 'في خدمة' }, $locale)}</span>
            <select class="input" bind:value={seg.ministryId}><option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>{#each allMinistries as m}<option value={m.id}>{tr(m.name, $locale)}</option>{/each}</select>
          </label>
          <label class="text-sm"><span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Not seen in', ar: 'لم يحضر منذ' }, $locale)}</span>
            <select class="input" bind:value={seg.inactiveWeeks}><option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option><option value="4">{tr({ en: '4+ weeks', ar: '4+ أسابيع' }, $locale)}</option><option value="8">{tr({ en: '8+ weeks', ar: '8+ أسابيع' }, $locale)}</option><option value="12">{tr({ en: '12+ weeks', ar: '12+ أسبوع' }, $locale)}</option></select>
          </label>
        </div>
      {:else if recipMode === 'people'}
        <div class="flex flex-wrap items-center gap-2">
          <input class="input max-w-xs" placeholder={tr({ en: 'Search members…', ar: 'ابحث عن أعضاء…' }, $locale)} bind:value={peopleSearch} oninput={searchPeople} />
          <button type="button" class="text-xs text-slate-500 hover:underline" onclick={selectAllShown}>{tr({ en: 'Select all shown', ar: 'تحديد الكل' }, $locale)}</button>
          <button type="button" class="text-xs text-slate-500 hover:underline" onclick={() => (selectedIds = new Set())}>{tr({ en: 'Clear', ar: 'مسح' }, $locale)}</button>
          <span class="text-xs font-medium" style="color: var(--brand)">{selectedIds.size} {tr({ en: 'selected', ar: 'محدد' }, $locale)}</span>
        </div>
        <div class="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          {#each peopleList as p (p.id)}
            <label class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <input type="checkbox" checked={selectedIds.has(p.id)} onchange={() => toggleId(p.id)} />
              <span>{personName(p)}</span>
              <span class="ms-auto force-ltr text-xs text-slate-400">{form.channel === 'email' ? (p.email ?? '') : (p.mobile ?? '')}</span>
            </label>
          {:else}
            <p class="px-2 py-1 text-xs text-slate-400">{tr({ en: 'No matching opted-in members.', ar: 'لا يوجد أعضاء موافقون مطابقون.' }, $locale)}</p>
          {/each}
        </div>
      {:else}
        <div class="space-y-2">
          <input class="input max-w-sm" placeholder={tr({ en: 'Search a member…', ar: 'ابحث عن عضو…' }, $locale)} bind:value={peopleSearch} oninput={searchPeople} />
          {#if peopleList.length && !onePersonId}
            <div class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {#each peopleList as p (p.id)}
                <button type="button" class="block w-full rounded px-2 py-1 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onclick={() => { onePersonId = p.id; oneContact = ''; peopleSearch = personName(p); }}>{personName(p)} <span class="force-ltr text-xs text-slate-400">{form.channel === 'email' ? (p.email ?? '') : (p.mobile ?? '')}</span></button>
              {/each}
            </div>
          {/if}
          {#if onePersonId}<p class="text-xs text-emerald-600 dark:text-emerald-400">✓ {peopleSearch} <button type="button" class="ms-1 text-rose-600 hover:underline" onclick={() => { onePersonId = null; peopleSearch = ''; }}>{tr({ en: 'change', ar: 'تغيير' }, $locale)}</button></p>{/if}
          <p class="text-xs text-slate-400">{tr({ en: 'or type a number / email directly:', ar: 'أو اكتب رقماً / بريداً مباشرة:' }, $locale)}</p>
          <input class="input force-ltr max-w-sm" placeholder={form.channel === 'email' ? 'name@example.com' : '+1 555 0100'} bind:value={oneContact} oninput={() => { if (oneContact) onePersonId = null; }} />
        </div>
      {/if}
    </div>

    <!-- Preview + actions -->
    <div class="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      <button type="button" class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={preview}>👁 {tr({ en: 'Preview', ar: 'معاينة' }, $locale)}</button>

      {#if recipMode === 'one'}
        <button class="btn-primary" onclick={quickSend} disabled={saving}>{saving ? $t('common.loading') : tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}</button>
      {:else}
        <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={saveDraft} disabled={saving}>{tr({ en: 'Save draft', ar: 'حفظ مسودة' }, $locale)}</button>
        <button class="btn-primary" onclick={sendNow} disabled={saving}>{tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}</button>
        <span class="text-slate-300 dark:text-slate-600">|</span>
        <label class="space-y-1 text-sm">
          <span class="block text-slate-500">{tr({ en: 'Schedule once', ar: 'جدولة مرة' }, $locale)}</span>
          <input class="input force-ltr" type="datetime-local" bind:value={scheduleAt} />
        </label>
        <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={schedule} disabled={saving || !scheduleAt}>🕐 {tr({ en: 'Schedule', ar: 'جدولة' }, $locale)}</button>
        <button type="button" class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={() => (showRecurring = !showRecurring)}>🔁 {tr({ en: 'Recurring', ar: 'متكرر' }, $locale)}</button>
      {/if}
    </div>

    {#if showRecurring && recipMode !== 'one'}
      <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p class="mb-2 text-sm font-medium">🔁 {tr({ en: 'Send on a repeating schedule', ar: 'إرسال بجدول متكرر' }, $locale)}</p>
        <ScheduleEditor bind:schedule={sched} showOnce={false} />
        <button class="btn-primary mt-2" onclick={scheduleRecurring} disabled={saving}>{tr({ en: 'Save recurring send', ar: 'حفظ الإرسال المتكرر' }, $locale)}</button>
      </div>
    {/if}

    <a class="text-sm text-slate-500 hover:underline" href="/messages">← {tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</a>
  </div>
</div>

<!-- Preview modal: the message exactly as a recipient sees it -->
{#if previewOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => (previewOpen = false)} role="presentation">
    <div class="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="font-semibold">{tr({ en: 'Preview', ar: 'معاينة' }, $locale)}</h3>
        <button type="button" class="text-slate-400 hover:text-slate-600" onclick={() => (previewOpen = false)} aria-label="Close">✕</button>
      </div>
      {#if previewing}
        <p class="text-sm text-slate-400">{$t('common.loading')}</p>
      {:else if previewData?.error}
        <p class="text-sm text-rose-600">{previewData.error}</p>
      {:else if previewData?.channel === 'email'}
        {#if previewData.subject}<p class="mb-2 text-sm"><span class="text-slate-400">{tr({ en: 'Subject:', ar: 'الموضوع:' }, $locale)}</span> <b>{previewData.subject}</b></p>{/if}
        <iframe title="preview" srcdoc={previewData.html} sandbox="" class="h-[460px] w-full rounded-md border border-slate-200 bg-white dark:border-slate-700"></iframe>
      {:else if previewData}
        <div class="rounded-2xl bg-emerald-100 p-3 text-sm text-slate-800 dark:bg-emerald-900/40 dark:text-slate-100" style="white-space:pre-wrap">{previewData.text}</div>
        <p class="mt-2 text-xs text-slate-400">{form.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} {tr({ en: 'message preview', ar: 'معاينة الرسالة' }, $locale)}</p>
      {/if}
    </div>
  </div>
{/if}
