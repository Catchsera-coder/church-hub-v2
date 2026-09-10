<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, displayName, enabledLocales } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';

  // In-page family roster. Everything writes people.householdId (and person
  // fields), so members ↔ families stay in sync automatically. The parent owns
  // the members array + stats; we call `onchanged` after any mutation so both
  // the roster and the family header refresh from one source of truth.
  let { householdId, members, onchanged }: {
    householdId: number;
    members: any[];
    onchanged: () => Promise<void> | void;
  } = $props();

  const editable = can('update person');
  const canMessage = can('create message');

  // attach existing
  let query = $state('');
  let results = $state<any[]>([]);
  let timer: ReturnType<typeof setTimeout>;
  // quick add new
  let showAdd = $state(false);
  let newFirst = $state('');
  let newLast = $state('');
  let newRole = $state('');
  let busy = $state(false);

  // inline edit — one member at a time
  let editingId = $state<number | null>(null);
  let draft = $state<any>(null);
  let saving = $state(false);
  let editError = $state('');

  const ROLES = [
    { en: 'Father', ar: 'أب' }, { en: 'Mother', ar: 'أم' }, { en: 'Son', ar: 'ابن' },
    { en: 'Daughter', ar: 'ابنة' }, { en: 'Guardian', ar: 'وصي' }, { en: 'Grandparent', ar: 'جد/جدة' },
  ];
  const STATUSES = ['visitor', 'regular', 'member', 'inactive'];

  // ---- helpers ----------------------------------------------------------------
  function ageOf(dob: string | null | undefined): number | null {
    if (!dob) return null;
    const d = new Date(dob); if (isNaN(+d)) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }
  function birthdayThisMonth(dob: string | null | undefined): boolean {
    if (!dob) return false;
    const d = new Date(dob); if (isNaN(+d)) return false;
    return d.getMonth() === new Date().getMonth();
  }
  // The household "head" is whoever is marked self / head of household.
  function isHead(role: string | null | undefined): boolean {
    const r = (role ?? '').toLowerCase();
    return r === 'self' || r === 'head' || r === 'رب الأسرة';
  }
  const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];
  function avatar(m: any): { initials: string; color: string } {
    const name = displayName(m, 'given-first', $locale) || '?';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return { initials, color: AVATAR_COLORS[h % AVATAR_COLORS.length] };
  }

  // ---- roster mutations -------------------------------------------------------
  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (query.trim().length < 2) { results = []; return; }
      const q = new URLSearchParams({ search: query.trim(), limit: '8' });
      const all = (await api<{ data: any[] }>(`/people?${q}`)).data;
      results = all.filter((p) => !members.some((m) => m.id === p.id));
    }, 250);
  }
  async function attach(p: any) {
    busy = true;
    try { await api(`/people/${p.id}`, { method: 'PUT', body: JSON.stringify({ householdId }) }); query = ''; results = []; await onchanged(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }
  async function addNew() {
    if (!newFirst.trim()) return;
    busy = true;
    try {
      await api('/people', { method: 'POST', body: JSON.stringify({
        givenName: { en: newFirst.trim() }, familyName: { en: newLast.trim() },
        householdId, householdRole: newRole.trim() || null,
      }) });
      newFirst = ''; newLast = ''; newRole = ''; showAdd = false; await onchanged();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }
  // Remove / move-out flow. Clicking 🗑 opens an inline choice (below) instead of
  // a blunt delete: "Move to their own family" (split a same-surname person into
  // their own household) or "Remove from family" (leave them family-less). Both
  // keep the person's profile and both are reversible via the Undo banner.
  let removingId = $state<number | null>(null);
  // Remembers the last remove/move so it can be undone: restore to the family we
  // just took them out of (this household).
  let lastUndo = $state<{ id: number; name: string; toHousehold: number } | null>(null);

  function askRemove(m: any) { removingId = removingId === m.id ? null : m.id; }
  async function doRemove(m: any, mode: 'orphan' | 'own') {
    busy = true; removingId = null;
    try {
      if (mode === 'own') {
        // Split them into their own new household, named after them, carrying their
        // own phone/address, and made head — for a same-surname person who isn't
        // actually part of this family (e.g. "Maged M" vs the other Ghobrials).
        const name: Record<string, string> = {};
        if (m.familyName?.en) name.en = m.familyName.en;
        if (m.familyName?.ar) name.ar = m.familyName.ar;
        if (!name.en && !name.ar) name.en = displayName(m, 'given-first', $locale) || 'Family';
        const created = await api<{ data: { id: number } }>('/families', { method: 'POST', body: JSON.stringify({
          name, homePhone: m.mobile ?? null,
          addressLine1: m.addressLine1 ?? null, addressLine2: m.addressLine2 ?? null,
          city: m.city ?? null, region: m.region ?? null, postalCode: m.postalCode ?? null, country: m.country ?? null,
        }) });
        await api(`/people/${m.id}`, { method: 'PUT', body: JSON.stringify({ householdId: created.data.id, householdRole: 'head' }) });
      } else {
        await api(`/people/${m.id}`, { method: 'PUT', body: JSON.stringify({ householdId: null }) });
      }
      lastUndo = { id: m.id, name: displayName(m, $nameOrder, $locale), toHousehold: householdId };
      if (editingId === m.id) cancelEdit();
      await onchanged();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }
  async function undoRemove() {
    if (!lastUndo) return;
    const u = lastUndo; busy = true;
    try { await api(`/people/${u.id}`, { method: 'PUT', body: JSON.stringify({ householdId: u.toHousehold }) }); lastUndo = null; await onchanged(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }

  // Bulk split: select several members and move them together into a NEW household
  // — the fast fix for an over-merged import that lumped different families under
  // one surname.
  let selected = $state<Set<number>>(new Set());
  function toggleSel(id: number) { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); selected = s; }
  async function moveSelectedToNewFamily() {
    if (!selected.size) return;
    const chosen = members.filter((m) => selected.has(m.id));
    if (!confirm(tr({ en: `Move ${chosen.length} selected people into a new family of their own?`, ar: `نقل ${chosen.length} أشخاص محددين إلى عائلة جديدة خاصة بهم؟` }, $locale))) return;
    busy = true;
    try {
      const first = chosen[0];
      const name: Record<string, string> = {};
      if (first?.familyName?.en) name.en = first.familyName.en;
      if (first?.familyName?.ar) name.ar = first.familyName.ar;
      if (!name.en && !name.ar) name.en = tr({ en: 'New family', ar: 'عائلة جديدة' }, $locale);
      const created = await api<{ data: { id: number } }>('/families', { method: 'POST', body: JSON.stringify({ name }) });
      for (const m of chosen) await api(`/people/${m.id}`, { method: 'PUT', body: JSON.stringify({ householdId: created.data.id }) });
      selected = new Set();
      await onchanged();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }
  function messagePerson(m: any) { goto(`/messages/new?people=${m.id}`); }

  // ---- inline edit ------------------------------------------------------------
  function startEdit(m: any) {
    editError = '';
    draft = {
      givenName: { ...(m.givenName ?? {}) },
      familyName: { ...(m.familyName ?? {}) },
      householdRole: m.householdRole ?? '',
      membershipStatus: m.membershipStatus ?? 'visitor',
      email: m.email ?? '',
      mobile: m.mobile ?? '',
      dateOfBirth: m.dateOfBirth ?? '',
      isActive: m.isActive ?? true,
      emailOptOut: m.emailOptOut ?? false,
      smsOptOut: m.smsOptOut ?? false,
      whatsappOptOut: m.whatsappOptOut ?? false,
    };
    editingId = m.id;
  }
  function cancelEdit() { editingId = null; draft = null; editError = ''; }
  async function saveEdit() {
    if (editingId == null) return;
    saving = true; editError = '';
    try {
      await api(`/people/${editingId}`, { method: 'PUT', body: JSON.stringify({
        ...draft,
        householdRole: draft.householdRole?.trim() || null,
        email: draft.email?.trim() || null,
        mobile: draft.mobile?.trim() || null,
        dateOfBirth: draft.dateOfBirth || null,
      }) });
      cancelEdit();
      await onchanged();
    } catch (err) { editError = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { saving = false; }
  }
</script>

<div class="card p-5 sm:p-6">
  <div class="mb-4 flex items-center justify-between gap-3">
    <h2 class="font-semibold">{tr({ en: 'Family members', ar: 'أفراد العائلة' }, $locale)}
      <span class="ms-1 text-sm font-normal text-slate-400">({members.length})</span>
    </h2>
    {#if editable}
      <button class="btn-ghost text-sm" style="color: var(--brand)" onclick={() => { showAdd = !showAdd; }}>
        {showAdd ? tr({ en: '✕ Close', ar: '✕ إغلاق' }, $locale) : tr({ en: '+ Add member', ar: '+ إضافة فرد' }, $locale)}
      </button>
    {/if}
  </div>

  {#if lastUndo}
    <div class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-900/30">
      <span class="text-amber-800 dark:text-amber-200">↩ {tr({ en: `Moved ${lastUndo.name} out of this family.`, ar: `تم نقل ${lastUndo.name} خارج هذه العائلة.` }, $locale)}</span>
      <button class="ms-auto rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-transparent dark:text-amber-200" disabled={busy} onclick={undoRemove}>{tr({ en: 'Undo', ar: 'تراجع' }, $locale)}</button>
      <button class="text-xs text-amber-700 hover:underline dark:text-amber-300" onclick={() => (lastUndo = null)}>{tr({ en: 'Dismiss', ar: 'إغلاق' }, $locale)}</button>
    </div>
  {/if}

  {#if editable && showAdd}
    <div class="mb-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <!-- Attach existing -->
      <div class="relative">
        <label class="mb-1 block text-xs font-medium text-slate-500">{tr({ en: 'Add an existing person', ar: 'إضافة شخص موجود' }, $locale)}</label>
        <input class="input" bind:value={query} oninput={search} placeholder={tr({ en: 'Search by name…', ar: 'ابحث بالاسم…' }, $locale)} />
        {#if results.length}
          <div class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {#each results as p}
              <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => attach(p)} disabled={busy}>{displayName(p, $nameOrder, $locale)}</button>
            {/each}
          </div>
        {/if}
      </div>
      <!-- Quick add new -->
      <div>
        <label class="mb-1 block text-xs font-medium text-slate-500">{tr({ en: 'Or add someone new', ar: 'أو أضف شخصاً جديداً' }, $locale)}</label>
        <div class="flex flex-wrap gap-2">
          <input class="input min-w-[7rem] flex-1" bind:value={newFirst} placeholder={tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} />
          <input class="input min-w-[7rem] flex-1" bind:value={newLast} placeholder={tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} />
          <input class="input w-28" list="fm-roles" bind:value={newRole} placeholder={tr({ en: 'Role', ar: 'الدور' }, $locale)} maxlength="20" />
          <button class="btn-primary shrink-0" onclick={addNew} disabled={busy || !newFirst.trim()}>{tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if members.length === 0}
    <p class="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
      {tr({ en: 'No one in this family yet. Add the first member above.', ar: 'لا أحد في هذه العائلة بعد. أضف أول فرد بالأعلى.' }, $locale)}
    </p>
  {:else}
    {#if editable && selected.size > 0}
      <div class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm dark:border-primary-800 dark:bg-primary-900/30">
        <span class="font-medium text-primary-800 dark:text-primary-200">{selected.size} {tr({ en: 'selected', ar: 'محدد' }, $locale)}</span>
        <button class="rounded-md border border-primary-300 bg-white px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50 dark:border-primary-700 dark:bg-transparent dark:text-primary-300" disabled={busy} onclick={moveSelectedToNewFamily}>🏠 {tr({ en: 'Move to a new family', ar: 'نقل إلى عائلة جديدة' }, $locale)}</button>
        <button class="ms-auto text-xs text-primary-700 hover:underline dark:text-primary-300" onclick={() => (selected = new Set())}>{tr({ en: 'Clear', ar: 'مسح' }, $locale)}</button>
      </div>
    {/if}
    <ul class="space-y-2">
      {#each members as m (m.id)}
        {@const av = avatar(m)}
        {@const age = ageOf(m.dateOfBirth)}
        <li class="rounded-xl border border-slate-200 transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600">
          <!-- summary row -->
          <div class="flex items-start gap-3 p-3">
            {#if editable}<input type="checkbox" class="mt-3 shrink-0" checked={selected.has(m.id)} onchange={() => toggleSel(m.id)} aria-label={tr({ en: 'Select', ar: 'تحديد' }, $locale)} />{/if}
            <span class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style="background:{av.color}">{av.initials}</span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{m.id}">{displayName(m, $nameOrder, $locale)}</a>
                {#if isHead(m.householdRole)}<span title={tr({ en: 'Head of household', ar: 'رب الأسرة' }, $locale)}>⭐</span>{/if}
                {#if m.householdRole && !isHead(m.householdRole)}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{m.householdRole}</span>{/if}
                <span class="rounded-full px-2 py-0.5 text-xs capitalize
                  {m.membershipStatus === 'member' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : m.membershipStatus === 'inactive' ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'}">{m.membershipStatus}</span>
                {#if m.selfRegistered && !m.reviewedAt}<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr({ en: 'new', ar: 'جديد' }, $locale)}</span>{/if}
                {#if age != null}<span class="text-xs text-slate-400">· {age} {tr({ en: 'yrs', ar: 'سنة' }, $locale)}</span>{/if}
                {#if birthdayThisMonth(m.dateOfBirth)}<span title={tr({ en: 'Birthday this month', ar: 'عيد ميلاد هذا الشهر' }, $locale)}>🎂</span>{/if}
              </div>
              {#if m.mobile || m.email}
                <div class="force-ltr mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                  {#if m.mobile}<a href="tel:{m.mobile}" class="hover:underline">📱 {m.mobile}</a>{/if}
                  {#if m.email}<a href="mailto:{m.email}" class="hover:underline">✉️ {m.email}</a>{/if}
                </div>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-1">
              {#if canMessage}<button class="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={tr({ en: 'Message', ar: 'رسالة' }, $locale)} onclick={() => messagePerson(m)}>✉️</button>{/if}
              {#if editable}
                <button class="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={tr({ en: 'Edit', ar: 'تعديل' }, $locale)} onclick={() => (editingId === m.id ? cancelEdit() : startEdit(m))}>{editingId === m.id ? '▲' : '✏️'}</button>
                <button class="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400" title={tr({ en: 'Remove from family…', ar: 'إزالة من العائلة…' }, $locale)} onclick={() => askRemove(m)}>🗑️</button>
              {/if}
            </div>
          </div>

          <!-- inline remove-choice: split into own family, or leave family-less -->
          {#if editable && removingId === m.id}
            <div class="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <p class="mb-3 text-sm text-slate-600 dark:text-slate-300">{tr({ en: `Take ${displayName(m, $nameOrder, $locale)} out of this family? Their profile is always kept, and you can Undo.`, ar: `إخراج ${displayName(m, $nameOrder, $locale)} من هذه العائلة؟ يبقى ملفه دائماً، ويمكنك التراجع.` }, $locale)}</p>
              <div class="flex flex-wrap gap-2">
                <button class="rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:border-primary-700 dark:bg-transparent dark:text-primary-300" disabled={busy} onclick={() => doRemove(m, 'own')}>🏠 {tr({ en: 'Move to their own family', ar: 'نقله إلى عائلته الخاصة' }, $locale)}</button>
                <button class="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:bg-transparent dark:text-rose-300" disabled={busy} onclick={() => doRemove(m, 'orphan')}>🚫 {tr({ en: 'Remove — no family', ar: 'إزالة — بدون عائلة' }, $locale)}</button>
                <button class="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:underline" disabled={busy} onclick={() => (removingId = null)}>{$t('common.cancel')}</button>
              </div>
              <p class="mt-2 text-xs text-slate-400">{tr({ en: '“Own family” is right when someone just shares a last name — e.g. a different Ghobrial household.', ar: '«عائلته الخاصة» مناسب عندما يتشارك اللقب فقط — مثل عائلة غبريال مختلفة.' }, $locale)}</p>
            </div>
          {/if}

          <!-- inline editor -->
          {#if editingId === m.id && draft}
            <div class="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              {#if editError}<p class="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{editError}</p>{/if}
              <div class="grid gap-3 sm:grid-cols-2">
                {#each $enabledLocales as l}
                  <label class="block space-y-1">
                    <span class="text-xs text-slate-500">{tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} ({l.native})</span>
                    <input class="input" dir={l.dir} bind:value={draft.givenName[l.code]} />
                  </label>
                  <label class="block space-y-1">
                    <span class="text-xs text-slate-500">{tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} ({l.native})</span>
                    <input class="input" dir={l.dir} bind:value={draft.familyName[l.code]} />
                  </label>
                {/each}
                <label class="block space-y-1">
                  <span class="text-xs text-slate-500">{tr({ en: 'Role in family', ar: 'الدور في العائلة' }, $locale)}</span>
                  <input class="input" list="fm-roles" bind:value={draft.householdRole} maxlength="20" placeholder={tr({ en: 'e.g. Father', ar: 'مثال: أب' }, $locale)} />
                </label>
                <label class="block space-y-1">
                  <span class="text-xs text-slate-500">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
                  <select class="input capitalize" bind:value={draft.membershipStatus}>{#each STATUSES as s}<option value={s}>{s}</option>{/each}</select>
                </label>
                <label class="block space-y-1">
                  <span class="text-xs text-slate-500">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</span>
                  <input class="input force-ltr" bind:value={draft.mobile} />
                </label>
                <label class="block space-y-1">
                  <span class="text-xs text-slate-500">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span>
                  <input class="input force-ltr" type="email" bind:value={draft.email} />
                </label>
                <label class="block space-y-1">
                  <span class="text-xs text-slate-500">🎂 {tr({ en: 'Date of birth', ar: 'تاريخ الميلاد' }, $locale)}</span>
                  <input class="input force-ltr" type="date" bind:value={draft.dateOfBirth} />
                </label>
                <label class="flex items-center gap-2 pt-5 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" bind:checked={draft.isActive} /> {tr({ en: 'Active', ar: 'نشط' }, $locale)}
                </label>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span>{tr({ en: 'Opted out:', ar: 'منسحب من:' }, $locale)}</span>
                <label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={draft.emailOptOut} /> {tr({ en: 'Email', ar: 'البريد' }, $locale)}</label>
                <label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={draft.smsOptOut} /> SMS</label>
                <label class="flex items-center gap-1.5"><input type="checkbox" bind:checked={draft.whatsappOptOut} /> {tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</label>
              </div>
              <div class="mt-4 flex items-center gap-2">
                <button class="btn-primary" onclick={saveEdit} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
                <button class="btn-ghost" onclick={cancelEdit} disabled={saving}>{$t('common.cancel')}</button>
                <a class="btn-ghost ms-auto text-xs text-slate-500" href="/members/{m.id}">{tr({ en: 'Full profile →', ar: 'الملف الكامل ←' }, $locale)}</a>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <datalist id="fm-roles">
    {#each ROLES as r}<option value={tr(r, $locale)}></option>{/each}
  </datalist>
</div>
