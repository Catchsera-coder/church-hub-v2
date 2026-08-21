<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';

  // Share a care case with the wider church: pick a purpose (which auto-writes the
  // message), a channel, and an audience, then send. Reuses the messaging engine
  // (opt-outs, reach count, branded send) — nothing sends until "Send" is clicked.
  let { item, onclose }: { item: any; onclose: () => void } = $props();

  const PURPOSES = [
    { v: 'prayer', icon: '🙏', en: 'Prayer request', ar: 'طلب صلاة' },
    { v: 'help', icon: '🙌', en: 'Ask for help', ar: 'طلب مساعدة' },
    { v: 'donation', icon: '💛', en: 'Donation', ar: 'تبرع' },
    { v: 'update', icon: '📢', en: 'Update', ar: 'تحديث' },
  ];
  const CHANNELS = [
    { v: 'sms', icon: '💬', en: 'SMS', ar: 'رسالة' },
    { v: 'email', icon: '✉️', en: 'Email', ar: 'بريد' },
    { v: 'whatsapp', icon: '🟢', en: 'WhatsApp', ar: 'واتساب' },
  ];

  // The safe, name-free seed text for the body: prefer the anonymous summary.
  const seed = (item.summary?.trim?.() || item.summary || '').trim() || item.subject || '';

  // Default the purpose from the care type (prayer→prayer, task/care→help, else update).
  const initialPurpose = item.type === 'prayer' ? 'prayer' : (item.type === 'task' || item.type === 'care') ? 'help' : 'update';

  let purpose = $state(initialPurpose);
  let channel = $state<'sms' | 'email' | 'whatsapp'>('sms');
  let audienceMode = $state<'all' | 'ministries' | 'people'>('all');
  let subject = $state<Record<string, string>>({});
  let body = $state<Record<string, string>>({});
  let ctaUrl = $state('');
  let bodyTouched = $state(false); // once the sender edits, stop auto-overwriting

  // Auto-write the template from the purpose (until the sender edits it).
  function template(p: string) {
    const s = seed;
    switch (p) {
      case 'prayer': return {
        subject: { en: '🙏 Prayer request', ar: '🙏 طلب صلاة' },
        body: { en: `🙏 Prayer request: ${s}\n\nPlease join us in praying. — {{churchName}}`, ar: `🙏 طلب صلاة: ${s}\n\nنرجو أن نصلّي معاً. — {{churchName}}` } };
      case 'help': return {
        subject: { en: '🙌 We need your help', ar: '🙌 نحتاج مساعدتكم' },
        body: { en: `🙌 We need your help: ${s}\n\nIf you're able to help, please reply or contact the church. — {{churchName}}`, ar: `🙌 نحتاج مساعدتكم: ${s}\n\nإن كان بإمكانكم المساعدة، تواصلوا مع الكنيسة. — {{churchName}}` } };
      case 'donation': return {
        subject: { en: '💛 An opportunity to give', ar: '💛 فرصة للعطاء' },
        body: { en: `💛 ${s}\n\nYour gift makes a real difference. — {{churchName}}`, ar: `💛 ${s}\n\nعطاؤكم يصنع فرقاً حقيقياً. — {{churchName}}` } };
      default: return {
        subject: { en: '📢 A note from church', ar: '📢 رسالة من الكنيسة' },
        body: { en: `📢 ${s} — {{churchName}}`, ar: `📢 ${s} — {{churchName}}` } };
    }
  }
  function applyTemplate(p: string) { const t = template(p); subject = { ...t.subject }; body = { ...t.body }; bodyTouched = false; }
  function setPurpose(p: string) { purpose = p; applyTemplate(p); }
  applyTemplate(initialPurpose); // seed once on open

  // Group + people pickers.
  let ministries = $state<any[]>([]);
  let selMinistries = $state<Set<number>>(new Set());
  function toggleMin(id: number) { const s = new Set(selMinistries); s.has(id) ? s.delete(id) : s.add(id); selMinistries = s; refreshReach(); }
  let peopleQuery = $state('');
  let peopleList = $state<any[]>([]);
  let selPeople = $state<Set<number>>(new Set());
  let selPeopleNames = $state<Record<number, string>>({});
  let ptimer: ReturnType<typeof setTimeout>;
  function searchPeople() {
    clearTimeout(ptimer);
    const q = peopleQuery.trim();
    ptimer = setTimeout(async () => {
      try { peopleList = (await api<{ data: any[] }>(`/people?optedIn=${channel}&limit=30${q ? `&search=${encodeURIComponent(q)}` : ''}`)).data; }
      catch { peopleList = []; }
    }, 220);
  }
  function togglePerson(p: any) {
    const s = new Set(selPeople);
    if (s.has(p.id)) { s.delete(p.id); } else { s.add(p.id); selPeopleNames[p.id] = displayName(p, $nameOrder, $locale); }
    selPeople = s; refreshReach();
  }

  onMount(async () => { try { ministries = (await api<{ data: any[] }>('/ministries')).data; } catch { /* optional */ } refreshReach(); });

  function currentAudience(): any {
    if (audienceMode === 'ministries') return { mode: 'ministries', ministryIds: [...selMinistries] };
    if (audienceMode === 'people') return { mode: 'people', personIds: [...selPeople] };
    return { mode: 'all' };
  }
  function setAudienceMode(m: 'all' | 'ministries' | 'people') { audienceMode = m; refreshReach(); if (m === 'people' && !peopleList.length) searchPeople(); }

  // Live "reaches ~N" for the chosen channel + audience (debounced).
  let reach = $state<number | null>(null);
  let reachTimer: ReturnType<typeof setTimeout>;
  function refreshReach() {
    clearTimeout(reachTimer);
    reach = null;
    reachTimer = setTimeout(async () => {
      try { reach = (await api<{ data: { count: number } }>('/messages/audience-count', { method: 'POST', body: JSON.stringify({ channel, audience: currentAudience() }) })).data.count; }
      catch { reach = null; }
    }, 250);
  }
  function setChannel(c: 'sms' | 'email' | 'whatsapp') { channel = c; refreshReach(); }

  let sending = $state(false);
  let sent = $state<{ sent: number; total: number } | null>(null);
  let error = $state('');

  async function send() {
    if (!body.en?.trim()) { error = tr({ en: 'Write a message first.', ar: 'اكتب رسالة أولاً.' }, $locale); return; }
    if (audienceMode === 'ministries' && !selMinistries.size) { error = tr({ en: 'Pick at least one group.', ar: 'اختر مجموعة واحدة على الأقل.' }, $locale); return; }
    if (audienceMode === 'people' && !selPeople.size) { error = tr({ en: 'Pick at least one person.', ar: 'اختر شخصاً واحداً على الأقل.' }, $locale); return; }
    const who = audienceMode === 'all'
      ? tr({ en: `all ${reach ?? ''} members`, ar: `كل الأعضاء (${reach ?? ''})` }, $locale)
      : tr({ en: `${reach ?? ''} people`, ar: `${reach ?? ''} أشخاص` }, $locale);
    if (!confirm(tr({ en: `Send this ${channel.toUpperCase()} to ${who} now?`, ar: `إرسال هذه الرسالة (${channel}) إلى ${who} الآن؟` }, $locale))) return;
    sending = true; error = '';
    try {
      const isDonation = purpose === 'donation' && channel === 'email' && ctaUrl.trim();
      const { data } = await api<{ data: { id: number } }>('/messages', {
        method: 'POST',
        body: JSON.stringify({
          name: `Care · ${item.subject}`.slice(0, 180),
          channel,
          subject: channel === 'email' ? subject : {},
          body,
          audience: currentAudience(),
          ctaLabel: isDonation ? { en: 'Give now', ar: 'تبرّع الآن' } : null,
          ctaUrl: isDonation ? ctaUrl.trim() : null,
        }),
      });
      const res = await api<{ data: { sent: number; total: number } }>(`/messages/${data.id}/send`, { method: 'POST' });
      sent = res.data;
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; } finally { sending = false; }
  }

  const purposeMeta = (v: string) => PURPOSES.find((p) => p.v === v) ?? PURPOSES[0];
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onclick={onclose} role="presentation">
  <div class="my-8 w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <div class="flex items-start justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold">📣 {tr({ en: 'Share with others', ar: 'مشاركة مع الآخرين' }, $locale)}</h2>
        <p class="truncate text-xs text-slate-500">{tr({ en: 'About', ar: 'بخصوص' }, $locale)}: {item.subject}</p>
      </div>
      <button class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onclick={onclose} aria-label={tr({ en: 'Close', ar: 'إغلاق' }, $locale)}>✕</button>
    </div>

    {#if sent}
      <div class="p-8 text-center">
        <div class="mb-2 text-4xl">✅</div>
        <p class="text-lg font-semibold">{tr({ en: 'Sent!', ar: 'تم الإرسال!' }, $locale)}</p>
        <p class="mt-1 text-sm text-slate-500">{tr({ en: `Delivered to ${sent.sent} of ${sent.total} recipients.`, ar: `أُرسلت إلى ${sent.sent} من ${sent.total}.` }, $locale)}</p>
        <button class="btn-primary mt-5" onclick={onclose}>{tr({ en: 'Done', ar: 'تم' }, $locale)}</button>
      </div>
    {:else}
      <div class="space-y-4 p-5">
        {#if error}<p class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

        <!-- 1. Purpose (auto-writes the message) -->
        <div>
          <p class="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">1 · {tr({ en: 'What is this?', ar: 'ما نوع الرسالة؟' }, $locale)}</p>
          <div class="flex flex-wrap gap-2">
            {#each PURPOSES as p}
              <button type="button" class="rounded-lg border px-3 py-1.5 text-sm {purpose === p.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={purpose === p.v ? 'background: var(--brand)' : ''} onclick={() => setPurpose(p.v)}>{p.icon} {tr({ en: p.en, ar: p.ar }, $locale)}</button>
            {/each}
          </div>
        </div>

        <!-- 2. Channel -->
        <div>
          <p class="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">2 · {tr({ en: 'Send by', ar: 'أرسل عبر' }, $locale)}</p>
          <div class="flex flex-wrap gap-2">
            {#each CHANNELS as c}
              <button type="button" class="rounded-lg border px-3 py-1.5 text-sm {channel === c.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={channel === c.v ? 'background: var(--brand)' : ''} onclick={() => setChannel(c.v as any)}>{c.icon} {tr({ en: c.en, ar: c.ar }, $locale)}</button>
            {/each}
          </div>
        </div>

        <!-- 3. Audience -->
        <div>
          <p class="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">3 · {tr({ en: 'Who receives it?', ar: 'من يستقبلها؟' }, $locale)}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-lg border px-3 py-1.5 text-sm {audienceMode === 'all' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={audienceMode === 'all' ? 'background: var(--brand)' : ''} onclick={() => setAudienceMode('all')}>🌍 {tr({ en: 'All members', ar: 'كل الأعضاء' }, $locale)}</button>
            <button type="button" class="rounded-lg border px-3 py-1.5 text-sm {audienceMode === 'ministries' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={audienceMode === 'ministries' ? 'background: var(--brand)' : ''} onclick={() => setAudienceMode('ministries')}>👥 {tr({ en: 'A group', ar: 'مجموعة' }, $locale)}</button>
            <button type="button" class="rounded-lg border px-3 py-1.5 text-sm {audienceMode === 'people' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={audienceMode === 'people' ? 'background: var(--brand)' : ''} onclick={() => setAudienceMode('people')}>🧍 {tr({ en: 'Specific people', ar: 'أشخاص محددون' }, $locale)}</button>
          </div>

          {#if audienceMode === 'ministries'}
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each ministries as m}
                {@const on = selMinistries.has(m.id)}
                <button type="button" class="rounded-full border px-2.5 py-1 text-xs {on ? 'border-transparent bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}" onclick={() => toggleMin(m.id)}>{on ? '✓ ' : ''}{tr(m.name, $locale)}</button>
              {/each}
              {#if !ministries.length}<span class="text-xs text-slate-400">{tr({ en: 'No groups yet.', ar: 'لا مجموعات بعد.' }, $locale)}</span>{/if}
            </div>
          {:else if audienceMode === 'people'}
            <div class="mt-2 space-y-2">
              {#if selPeople.size}
                <div class="flex flex-wrap gap-1.5">
                  {#each [...selPeople] as pid}
                    <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{selPeopleNames[pid] ?? `#${pid}`}<button type="button" class="text-slate-400 hover:text-rose-600" onclick={() => togglePerson({ id: pid })}>✕</button></span>
                  {/each}
                </div>
              {/if}
              <input class="input" bind:value={peopleQuery} oninput={searchPeople} placeholder={tr({ en: 'Search a person…', ar: 'ابحث عن شخص…' }, $locale)} />
              {#if peopleList.length}
                <div class="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  {#each peopleList as p}
                    <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => togglePerson(p)}>
                      <span class="w-4">{selPeople.has(p.id) ? '✓' : ''}</span>{displayName(p, $nameOrder, $locale)}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <p class="mt-2 text-xs text-slate-500">
            {#if reach === null}{tr({ en: 'Counting reach…', ar: 'جارٍ حساب الوصول…' }, $locale)}{:else}📊 {tr({ en: `Reaches about ${reach} ${reach === 1 ? 'person' : 'people'} on ${channel.toUpperCase()}`, ar: `تصل إلى ${reach} تقريباً عبر ${channel}` }, $locale)}{tr({ en: ' (opted-in & contactable).', ar: ' (الموافقون والقابلون للتواصل).' }, $locale)}{/if}
          </p>
        </div>

        <!-- 4. Message (auto-written, editable) -->
        <div>
          <p class="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">4 · {tr({ en: 'Message', ar: 'الرسالة' }, $locale)} <span class="font-normal text-slate-400">{tr({ en: '· auto-written, edit freely', ar: '· مكتوبة تلقائياً، عدّلها بحرية' }, $locale)}</span></p>
          {#if channel === 'email'}
            <input class="input mb-2" bind:value={subject.en} placeholder={tr({ en: 'Email subject', ar: 'عنوان البريد' }, $locale)} />
          {/if}
          <textarea class="input min-h-[7rem] w-full" bind:value={body.en} oninput={() => (bodyTouched = true)}></textarea>
          <p class="mt-1 text-[11px] text-slate-400">{tr({ en: 'Tip: {{firstName}} and {{churchName}} fill in automatically per person. No names or private details are included unless you add them.', ar: 'تلميح: {{firstName}} و {{churchName}} تُملأ تلقائياً لكل شخص. لا تُدرَج أسماء أو تفاصيل خاصة إلا إذا أضفتها.' }, $locale)}</p>
          {#if purpose === 'donation' && channel === 'email'}
            <input class="input mt-2 force-ltr" bind:value={ctaUrl} placeholder={tr({ en: 'Giving link (adds a “Give now” button)', ar: 'رابط التبرع (يضيف زر «تبرّع الآن»)' }, $locale)} />
          {/if}
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-slate-100 p-5 dark:border-slate-800">
        <button class="btn-ghost" onclick={onclose}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button>
        <button class="btn-primary" onclick={send} disabled={sending || reach === 0}>{sending ? tr({ en: 'Sending…', ar: 'جارٍ الإرسال…' }, $locale) : `${purposeMeta(purpose).icon} ${tr({ en: 'Send', ar: 'إرسال' }, $locale)}${reach ? ` (${reach})` : ''}`}</button>
      </div>
    {/if}
  </div>
</div>
