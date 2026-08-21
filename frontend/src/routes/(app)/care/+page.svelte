<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  const editable = can('create care');
  const TYPES = [
    { v: 'prayer', en: 'Prayer', ar: 'صلاة', icon: '🙏' },
    { v: 'care', en: 'Care', ar: 'رعاية', icon: '❤️' },
    { v: 'visit', en: 'Visit', ar: 'زيارة', icon: '🚪' },
    { v: 'task', en: 'Task', ar: 'مهمة', icon: '✅' },
  ];
  const typeMeta = (v: string) => TYPES.find((x) => x.v === v) ?? TYPES[0];

  // WHO can see a care item.
  const SCOPES = [
    { v: 'private', icon: '🔒', en: 'Private', ar: 'خاص', dEn: 'Only you and church admins.', dAr: 'أنت ومدراء الكنيسة فقط.' },
    { v: 'assignees', icon: '👥', en: 'Assigned servants', ar: 'الخدام المعيّنون', dEn: 'The assignee plus any servants you pick below.', dAr: 'المسؤول والخدام الذين تختارهم بالأسفل.' },
    { v: 'church', icon: '🌍', en: 'All servants', ar: 'كل الخدام', dEn: 'Everyone with care access can see it.', dAr: 'كل من لديه صلاحية الرعاية.' },
  ];
  const scopeMeta = (v: string) => SCOPES.find((x) => x.v === v) ?? SCOPES[1];
  // HOW MUCH the wider audience sees (only relevant for the "All servants" scope).
  const DISCLOSURES = [
    { v: 'full', icon: '📖', en: 'Full details', ar: 'كل التفاصيل', dEn: 'Name + details.', dAr: 'الاسم والتفاصيل.' },
    { v: 'name', icon: '🪪', en: 'Name only', ar: 'الاسم فقط', dEn: 'Show the name, hide the details.', dAr: 'إظهار الاسم وإخفاء التفاصيل.' },
    { v: 'anonymous', icon: '🕶️', en: 'Anonymous', ar: 'مجهول', dEn: 'No name, no details — just your summary. The name is still kept for admins.', dAr: 'بدون اسم أو تفاصيل — فقط ملخصك. يبقى الاسم للمدراء.' },
  ];
  const discMeta = (v: string) => DISCLOSURES.find((x) => x.v === v) ?? DISCLOSURES[0];

  let rows = $state<any[]>([]);
  let assignees = $state<any[]>([]);
  let loading = $state(true);
  let tab = $state<'active' | 'mine' | 'done'>('active');
  let typeFilter = $state('');

  let editing = $state<any>(null); // the item being added/edited
  let saving = $state(false);
  let error = $state('');

  // person picker for the form
  let personQuery = $state('');
  let personResults = $state<any[]>([]);
  let ptimer: ReturnType<typeof setTimeout>;

  const today = new Date().toISOString().slice(0, 10);

  async function load() {
    loading = true;
    try {
      const q = new URLSearchParams();
      if (tab === 'done') q.set('status', 'done');
      else if (tab === 'mine') { q.set('mine', 'true'); q.set('status', 'active'); }
      else q.set('status', 'active');
      if (typeFilter) q.set('type', typeFilter);
      rows = (await api<{ data: any[] }>(`/care?${q}`)).data;
    } finally { loading = false; }
  }
  onMount(async () => {
    await load();
    try { assignees = (await api<{ data: any[] }>('/care/assignees')).data; } catch { /* optional */ }
  });

  function startNew() { editing = { type: 'prayer', subject: '', details: '', status: 'open', shareScope: 'assignees', shareDisclosure: 'full', sharedUserIds: [], summary: '', personId: null, personName: '', assignedToUserId: null, dueOn: '' }; error = ''; }
  function startEdit(r: any) { editing = { ...r, shareScope: r.shareScope ?? 'assignees', shareDisclosure: r.shareDisclosure ?? 'full', sharedUserIds: Array.isArray(r.sharedUserIds) ? [...r.sharedUserIds] : [], summary: r.summary ?? '', personName: r.personGiven ? displayName({ givenName: r.personGiven, familyName: r.personFamily }, $nameOrder, $locale) : '', dueOn: r.dueOn ?? '' }; error = ''; }
  function toggleShared(uid: number) { const s = new Set<number>(editing.sharedUserIds ?? []); if (s.has(uid)) s.delete(uid); else s.add(uid); editing.sharedUserIds = [...s]; }

  function searchPerson() {
    clearTimeout(ptimer);
    const s = personQuery.trim();
    if (s.length < 2) { personResults = []; return; }
    ptimer = setTimeout(async () => {
      try { personResults = (await api<{ data: any[] }>(`/people?search=${encodeURIComponent(s)}&limit=8`)).data; } catch { personResults = []; }
    }, 220);
  }
  function pickPerson(p: any) { editing.personId = p.id; editing.personName = displayName(p, $nameOrder, $locale); personResults = []; personQuery = ''; }

  async function save() {
    if (!editing.subject?.trim()) { error = tr({ en: 'Add a short subject.', ar: 'أضف عنواناً قصيراً.' }, $locale); return; }
    saving = true; error = '';
    try {
      const isChurch = editing.shareScope === 'church';
      const body = {
        type: editing.type, subject: editing.subject.trim(), details: editing.details?.trim() || null,
        status: editing.status,
        shareScope: editing.shareScope,
        shareDisclosure: isChurch ? editing.shareDisclosure : 'full',
        sharedUserIds: editing.shareScope === 'assignees' ? (editing.sharedUserIds ?? []).map(Number) : [],
        summary: (isChurch && editing.shareDisclosure === 'anonymous') ? (editing.summary?.trim() || null) : null,
        personId: editing.personId ?? null, assignedToUserId: editing.assignedToUserId ? Number(editing.assignedToUserId) : null,
        dueOn: editing.dueOn || null,
      };
      if (editing.id) await api(`/care/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/care', { method: 'POST', body: JSON.stringify(body) });
      editing = null; await load();
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; } finally { saving = false; }
  }
  async function setStatus(r: any, status: string) {
    try { await api(`/care/${r.id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function remove(r: any) {
    if (!confirm(tr({ en: 'Delete this care item?', ar: 'حذف عنصر الرعاية؟' }, $locale))) return;
    try { await api(`/care/${r.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  const assigneeName = (id: number | null) => assignees.find((a) => a.id === id)?.name ?? null;
</script>

<PageHeader title={tr({ en: 'Pastoral Care', ar: 'الرعاية الرعوية' }, $locale)}>
  {#snippet actions()}
    {#if editable}<button class="btn-primary" onclick={startNew}>{$t('common.new')}</button>{/if}
  {/snippet}
</PageHeader>

<PageHint id="care" text={{ en: 'Track prayer requests, care needs, visits and follow-up tasks. Choose who sees each one — private, a few servants, or all servants — and how much to reveal (full, name only, or anonymous). Names are always kept for admins. Move Open → In progress → Done as you care for people.', ar: 'تابع طلبات الصلاة والرعاية والزيارات والمهام. اختر من يراها — خاص أو بعض الخدام أو كل الخدام — وكم تكشف (كامل، الاسم فقط، أو مجهول). تبقى الأسماء للمدراء دائماً.' }} />

{#if editing}
  <div class="card mb-4 space-y-3 p-5">
    <p class="font-semibold">{editing.id ? tr({ en: 'Edit care item', ar: 'تعديل عنصر الرعاية' }, $locale) : tr({ en: 'New care item', ar: 'عنصر رعاية جديد' }, $locale)}</p>
    {#if error}<p class="text-xs text-rose-600 dark:text-rose-400">{error}</p>{/if}
    <div class="flex flex-wrap gap-2">
      {#each TYPES as ty}
        <button type="button" class="rounded-md border px-3 py-1.5 text-sm {editing.type === ty.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={editing.type === ty.v ? 'background: var(--brand)' : ''} onclick={() => (editing.type = ty.v)}>{ty.icon} {tr({ en: ty.en, ar: ty.ar }, $locale)}</button>
      {/each}
    </div>
    <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Subject', ar: 'الموضوع' }, $locale)}</span><input class="input" bind:value={editing.subject} placeholder={tr({ en: 'e.g. Hospital visit — surgery Friday', ar: 'مثال: زيارة مستشفى — عملية الجمعة' }, $locale)} /></label>
    <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Details', ar: 'التفاصيل' }, $locale)}</span><textarea class="input" rows="3" bind:value={editing.details}></textarea></label>
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="relative">
        <span class="mb-1 block text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'About (person, optional)', ar: 'يخص (شخص، اختياري)' }, $locale)}</span>
        {#if editing.personId}
          <div class="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"><span>👤 {editing.personName}</span><button type="button" class="ms-auto text-xs text-rose-600 hover:underline" onclick={() => { editing.personId = null; editing.personName = ''; }}>{tr({ en: 'Change', ar: 'تغيير' }, $locale)}</button></div>
        {:else}
          <input class="input" bind:value={personQuery} oninput={searchPerson} placeholder={tr({ en: 'Search a person…', ar: 'ابحث عن شخص…' }, $locale)} />
          {#if personResults.length}<div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">{#each personResults as p}<button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pickPerson(p)}>{displayName(p, $nameOrder, $locale)}</button>{/each}</div>{/if}
        {/if}
      </div>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Assign to', ar: 'إسناد إلى' }, $locale)}</span>
        <select class="input" bind:value={editing.assignedToUserId}><option value={null}>{tr({ en: '— Unassigned —', ar: '— غير مسند —' }, $locale)}</option>{#each assignees as a}<option value={a.id}>{a.name}</option>{/each}</select>
      </label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Due date', ar: 'تاريخ الاستحقاق' }, $locale)}</span><input class="input force-ltr" type="date" bind:value={editing.dueOn} /></label>
    </div>

    <!-- Smart sharing: who can see it, and how much of it. -->
    <div class="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div>
        <p class="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">🔐 {tr({ en: 'Who can see this?', ar: 'من يمكنه رؤية هذا؟' }, $locale)}</p>
        <div class="flex flex-wrap gap-2">
          {#each SCOPES as sc}
            <button type="button" class="rounded-md border px-3 py-1.5 text-sm {editing.shareScope === sc.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={editing.shareScope === sc.v ? 'background: var(--brand)' : ''} onclick={() => (editing.shareScope = sc.v)}>{sc.icon} {tr({ en: sc.en, ar: sc.ar }, $locale)}</button>
          {/each}
        </div>
      </div>

      {#if editing.shareScope === 'assignees' && assignees.length}
        <div>
          <p class="mb-1.5 text-xs text-slate-500">{tr({ en: 'Also share with these servants (optional):', ar: 'شارك أيضاً مع هؤلاء الخدام (اختياري):' }, $locale)}</p>
          <div class="flex flex-wrap gap-1.5">
            {#each assignees as a}
              {@const on = (editing.sharedUserIds ?? []).includes(a.id)}
              <button type="button" class="rounded-full border px-2.5 py-1 text-xs {on ? 'border-transparent bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}" onclick={() => toggleShared(a.id)}>{on ? '✓ ' : ''}{a.name}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if editing.shareScope === 'church'}
        <div>
          <p class="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">{tr({ en: 'How much to share?', ar: 'كم تشارك؟' }, $locale)}</p>
          <div class="flex flex-wrap gap-2">
            {#each DISCLOSURES as d}
              <button type="button" class="rounded-md border px-3 py-1.5 text-sm {editing.shareDisclosure === d.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={editing.shareDisclosure === d.v ? 'background: var(--brand)' : ''} onclick={() => (editing.shareDisclosure = d.v)}>{d.icon} {tr({ en: d.en, ar: d.ar }, $locale)}</button>
            {/each}
          </div>
        </div>
        {#if editing.shareDisclosure === 'anonymous'}
          <label class="block space-y-1">
            <span class="text-xs text-slate-500">{tr({ en: 'Public summary (no names, no private details)', ar: 'ملخص عام (بدون أسماء أو تفاصيل خاصة)' }, $locale)}</span>
            <input class="input" bind:value={editing.summary} maxlength="190" placeholder={tr({ en: 'e.g. A family needs prayer for health', ar: 'مثال: عائلة تحتاج للصلاة من أجل الصحة' }, $locale)} />
          </label>
        {/if}
      {/if}

      <p class="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        <span>💡</span>
        <span>{tr({ en: scopeMeta(editing.shareScope).dEn, ar: scopeMeta(editing.shareScope).dAr }, $locale)}{#if editing.shareScope === 'church'}{' '}{tr({ en: discMeta(editing.shareDisclosure).dEn, ar: discMeta(editing.shareDisclosure).dAr }, $locale)}{/if}{' '}{tr({ en: 'Admins always see the full item.', ar: 'يرى المدراء العنصر كاملاً دائماً.' }, $locale)}</span>
      </p>
    </div>

    <div class="flex gap-2"><button class="btn-primary" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button><button class="btn-ghost" onclick={() => (editing = null)}>{tr({ en: 'Cancel', ar: 'إلغاء' }, $locale)}</button></div>
  </div>
{/if}

<div class="mb-3 flex flex-wrap items-center gap-2">
  {#each [{ v: 'active', l: { en: 'Active', ar: 'نشط' } }, { v: 'mine', l: { en: 'Assigned to me', ar: 'المسندة إليّ' } }, { v: 'done', l: { en: 'Done', ar: 'منجز' } }] as tb}
    <button class="rounded-md border px-3 py-1.5 text-sm {tab === tb.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={tab === tb.v ? 'background: var(--brand)' : ''} onclick={() => { tab = tb.v as any; load(); }}>{tr(tb.l, $locale)}</button>
  {/each}
  <select class="input ms-auto w-auto py-1 text-sm" bind:value={typeFilter} onchange={load}>
    <option value="">{tr({ en: 'All types', ar: 'كل الأنواع' }, $locale)}</option>
    {#each TYPES as ty}<option value={ty.v}>{ty.icon} {tr({ en: ty.en, ar: ty.ar }, $locale)}</option>{/each}
  </select>
</div>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if rows.length === 0}
  <div class="card p-10 text-center text-slate-500">{tr({ en: 'Nothing here. 🎉', ar: 'لا شيء هنا. 🎉' }, $locale)}</div>
{:else}
  <div class="space-y-2">
    {#each rows as r (r.id)}
      {@const m = typeMeta(r.type)}
      {@const overdue = r.status !== 'done' && r.dueOn && r.dueOn < today}
      {@const sm = scopeMeta(r.shareScope ?? (r.confidential ? 'private' : 'assignees'))}
      <div class="card p-4 {r.status === 'done' ? 'opacity-70' : ''}">
        <div class="flex flex-wrap items-start gap-3">
          <span class="text-xl">{m.icon}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{r.subject}</span>
              <span class="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400" title={tr({ en: sm.en, ar: sm.ar }, $locale)}>{sm.icon}{#if (r.shareScope ?? '') === 'assignees' && r.sharedUserIds?.length}<span>+{r.sharedUserIds.length}</span>{/if}{#if r.shareScope === 'church' && r.shareDisclosure && r.shareDisclosure !== 'full'}<span>{discMeta(r.shareDisclosure).icon}</span>{/if}</span>
              <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tr({ en: m.en, ar: m.ar }, $locale)}</span>
              {#if r.status !== 'open'}<span class="rounded-full px-2 py-0.5 text-xs {r.status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}">{r.status === 'done' ? tr({ en: 'done', ar: 'منجز' }, $locale) : tr({ en: 'in progress', ar: 'قيد التنفيذ' }, $locale)}</span>{/if}
            </div>
            {#if r.personId}<a class="text-xs text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.personId}">👤 {displayName({ givenName: r.personGiven, familyName: r.personFamily }, $nameOrder, $locale)}</a>{/if}
            {#if r._disclosure === 'anonymous'}<p class="mt-1 text-xs italic text-slate-400">🕶️ {tr({ en: 'Shared anonymously — name & details kept private.', ar: 'مشارَك بشكل مجهول — الاسم والتفاصيل خاصة.' }, $locale)}</p>{:else if r._disclosure === 'name'}<p class="mt-1 text-xs italic text-slate-400">🪪 {tr({ en: 'Details hidden.', ar: 'التفاصيل مخفية.' }, $locale)}</p>{:else if r._redacted}<p class="mt-1 text-xs italic text-slate-400">🔒 {tr({ en: 'Confidential — details hidden.', ar: 'سرّي — التفاصيل مخفية.' }, $locale)}</p>{:else if r.details}<p class="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{r.details}</p>{/if}
            <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
              {#if r.assigneeName}<span>👤 {r.assigneeName}</span>{/if}
              {#if r.dueOn}<span class="force-ltr {overdue ? 'font-medium text-rose-600 dark:text-rose-400' : ''}">📅 {r.dueOn}{overdue ? ` · ${tr({ en: 'overdue', ar: 'متأخر' }, $locale)}` : ''}</span>{/if}
            </div>
          </div>
          {#if can('update care')}
            <div class="flex shrink-0 flex-wrap items-center gap-1">
              {#if r.status !== 'done'}
                {#if r.status === 'open'}<button class="btn-ghost text-xs" onclick={() => setStatus(r, 'in_progress')}>{tr({ en: 'Start', ar: 'بدء' }, $locale)}</button>{/if}
                <button class="btn-ghost text-xs text-emerald-700 dark:text-emerald-300" onclick={() => setStatus(r, 'done')}>✓ {tr({ en: 'Done', ar: 'إنجاز' }, $locale)}</button>
              {:else}
                <button class="btn-ghost text-xs" onclick={() => setStatus(r, 'open')}>{tr({ en: 'Reopen', ar: 'إعادة فتح' }, $locale)}</button>
              {/if}
              <button class="rounded p-1 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => startEdit(r)}>✏️</button>
              {#if can('delete care')}<button class="rounded p-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" onclick={() => remove(r)}>🗑️</button>{/if}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
