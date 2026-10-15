<script lang="ts">
  // Merge a duplicate person INTO this one, reversibly. Flow: find the duplicate →
  // see a required confirmation preview (what empty fields get filled + how many
  // records move) → confirm → merged, with a one-click Undo. Used from the member
  // profile and the family page.
  import { tr, locale } from '$lib/i18n.js';
  import { api } from '$lib/api.js';

  let { open = $bindable(false), primaryId, primaryName, given = {}, family = {}, ondone }:
    { open?: boolean; primaryId: number; primaryName: string; given?: any; family?: any; ondone?: () => void } = $props();

  let candidates = $state<any[]>([]);
  let search = $state('');
  let secondary = $state<any>(null);
  let preview = $state<any>(null);
  let loading = $state(false);
  let merging = $state(false);
  let undoing = $state(false);
  let error = $state('');
  let doneMergeId = $state<number | null>(null);

  $effect(() => { if (open) reset(); });
  function reset() { candidates = []; search = ''; secondary = null; preview = null; error = ''; doneMergeId = null; loadCandidates(); }

  async function loadCandidates() {
    loading = true;
    try {
      const g = (given?.en ?? given?.ar ?? '').trim();
      const f = (family?.en ?? family?.ar ?? '').trim();
      if (!g) { candidates = []; return; }
      const qs = new URLSearchParams(); qs.set('given', g); if (f) qs.set('family', f); qs.set('exclude', String(primaryId));
      candidates = (await api<{ data: any[] }>(`/people/duplicates?${qs}`)).data;
    } catch { candidates = []; } finally { loading = false; }
  }
  async function searchPeople() {
    const q = search.trim();
    if (!q) { loadCandidates(); return; }
    try { candidates = (await api<{ data: any[] }>(`/people?search=${encodeURIComponent(q)}&limit=20`)).data.filter((p) => p.id !== primaryId); } catch { /* ignore */ }
  }
  async function pick(p: any) {
    secondary = p; preview = null; error = '';
    try { preview = (await api<{ data: any }>(`/people/${primaryId}/merge-preview?secondaryId=${p.id}`)).data; }
    catch (e) { error = (e as Error).message; }
  }
  async function doMerge() {
    if (!secondary) return;
    merging = true; error = '';
    try {
      const { data } = await api<{ data: { mergeId: number } }>(`/people/${primaryId}/merge`, { method: 'POST', body: JSON.stringify({ secondaryId: secondary.id }) });
      doneMergeId = data.mergeId; ondone?.();
    } catch (e) { error = (e as Error).message; } finally { merging = false; }
  }
  async function undo() {
    if (!doneMergeId) return;
    undoing = true;
    try { await api(`/people/merges/${doneMergeId}/undo`, { method: 'POST' }); ondone?.(); open = false; }
    catch (e) { error = (e as Error).message; } finally { undoing = false; }
  }
  const name = (p: any) => `${tr(p.givenName ?? {}, $locale)} ${tr(p.familyName ?? {}, $locale)}`.trim();
  const FIELD_LABELS: Record<string, { en: string; ar: string }> = {
    email: { en: 'Email', ar: 'البريد' }, mobile: { en: 'Mobile', ar: 'الجوال' }, dateOfBirth: { en: 'Date of birth', ar: 'تاريخ الميلاد' },
    joinedOn: { en: 'Joined on', ar: 'تاريخ الانضمام' }, firstVisitOn: { en: 'First visit', ar: 'أول زيارة' }, addressLine1: { en: 'Address', ar: 'العنوان' },
    addressLine2: { en: 'Address 2', ar: 'العنوان 2' }, city: { en: 'City', ar: 'المدينة' }, region: { en: 'Region', ar: 'المنطقة' },
    postalCode: { en: 'Postal code', ar: 'الرمز البريدي' }, country: { en: 'Country', ar: 'الدولة' }, photoPath: { en: 'Photo', ar: 'الصورة' },
    notes: { en: 'Notes', ar: 'ملاحظات' }, householdRole: { en: 'Family role', ar: 'دور العائلة' }, followUpStage: { en: 'Follow-up stage', ar: 'مرحلة المتابعة' },
    baptizedOn: { en: 'Baptized on', ar: 'تاريخ المعمودية' }, baptismType: { en: 'Baptism type', ar: 'نوع المعمودية' }, middleName: { en: 'Middle name', ar: 'الاسم الأوسط' },
    nickName: { en: 'Nickname', ar: 'اللقب' }, householdId: { en: 'Family', ar: 'العائلة' }, baptized: { en: 'Baptized', ar: 'معمَّد' }, skills: { en: 'Skills', ar: 'المهارات' }, customFields: { en: 'Custom fields', ar: 'حقول إضافية' },
  };
  const COUNT_LABELS: { key: string; en: string; ar: string }[] = [
    { key: 'attendance', en: 'Attendance records', ar: 'سجلات الحضور' }, { key: 'giving', en: 'Giving records', ar: 'سجلات التبرع' },
    { key: 'ministries', en: 'Ministry memberships', ar: 'عضويات الخدمة' }, { key: 'serving', en: 'Serving assignments', ar: 'مهام الخدمة' },
    { key: 'messages', en: 'Messages received', ar: 'رسائل مُستلمة' }, { key: 'care', en: 'Care items', ar: 'بنود الرعاية' },
    { key: 'clearances', en: 'Clearances', ar: 'التصاريح' }, { key: 'conference', en: 'Conference registrations', ar: 'تسجيلات المؤتمر' },
  ];
  const fieldValue = (f: string, v: any) => f === 'baptized' ? '✓' : f === 'householdId' ? `#${v}` : (typeof v === 'object' ? tr(v, $locale) : String(v));
</script>

{#if open}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="button" tabindex="-1" onclick={() => (open = false)} onkeydown={(e) => e.key === 'Escape' && (open = false)}>
    <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog" tabindex="0" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <div class="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 class="text-lg font-semibold">🔗 {tr({ en: 'Merge a duplicate', ar: 'دمج نسخة مكررة' }, $locale)}</h2>
          <p class="text-sm text-slate-500">{tr({ en: 'Keeps', ar: 'يُبقي على' }, $locale)} <b>{primaryName}</b> · {tr({ en: 'the other record is removed (undoable).', ar: 'ويُزال السجل الآخر (يمكن التراجع).' }, $locale)}</p>
        </div>
        <button class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Close" onclick={() => (open = false)}>✕</button>
      </div>

      {#if error}<p class="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

      {#if doneMergeId}
        <!-- Success + easy undo -->
        <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/50 dark:bg-emerald-900/20">
          <p class="font-medium text-emerald-800 dark:text-emerald-200">✓ {tr({ en: 'Merged.', ar: 'تم الدمج.' }, $locale)} {secondary ? name(secondary) : ''} → {primaryName}</p>
          <p class="mt-1 text-emerald-700/80 dark:text-emerald-300/70">{tr({ en: 'Changed your mind? Undo puts everything back exactly.', ar: 'غيّرت رأيك؟ التراجع يُعيد كل شيء كما كان تماماً.' }, $locale)}</p>
          <div class="mt-3 flex gap-2">
            <button class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900" disabled={undoing} onclick={undo}>↩ {undoing ? '…' : tr({ en: 'Undo merge', ar: 'تراجع عن الدمج' }, $locale)}</button>
            <button class="btn-ghost text-sm" onclick={() => (open = false)}>{tr({ en: 'Done', ar: 'تم' }, $locale)}</button>
          </div>
        </div>
      {:else if preview}
        <!-- Required confirmation: exactly what will happen -->
        <div class="space-y-3">
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <p class="mb-1"><span class="text-slate-500">{tr({ en: 'Merge', ar: 'دمج' }, $locale)}</span> <b>{preview.secondary.name}</b> <span class="text-slate-500">{tr({ en: 'into', ar: 'في' }, $locale)}</span> <b>{preview.primary.name}</b></p>
          </div>
          {#if preview.filledFields.length}
            <div>
              <p class="mb-1 text-xs font-medium text-slate-500">{tr({ en: 'Empty fields that will be filled in:', ar: 'حقول فارغة ستُملأ:' }, $locale)}</p>
              <ul class="space-y-0.5 text-sm">
                {#each preview.filledFields as ff}
                  <li class="flex gap-2"><span class="text-slate-500">{tr(FIELD_LABELS[ff.field] ?? { en: ff.field, ar: ff.field }, $locale)}:</span> <span class="font-medium">{fieldValue(ff.field, ff.value)}</span></li>
                {/each}
              </ul>
            </div>
          {:else}
            <p class="text-sm text-slate-500">{tr({ en: 'No empty fields to fill — only records will move.', ar: 'لا حقول فارغة لملئها — ستُنقل السجلات فقط.' }, $locale)}</p>
          {/if}
          {#if preview.total}
            <div>
              <p class="mb-1 text-xs font-medium text-slate-500">{tr({ en: 'Records that will move to the kept record:', ar: 'سجلات ستُنقل إلى السجل المُبقى:' }, $locale)}</p>
              <div class="flex flex-wrap gap-1.5">
                {#each COUNT_LABELS as c}
                  {#if preview.counts[c.key]}<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs dark:bg-slate-800">{preview.counts[c.key]} {tr({ en: c.en, ar: c.ar }, $locale)}</span>{/if}
                {/each}
              </div>
            </div>
          {/if}
          <div class="flex gap-2 pt-1">
            <button class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style="background: var(--brand)" disabled={merging} onclick={doMerge}>{merging ? '…' : tr({ en: 'Confirm merge', ar: 'تأكيد الدمج' }, $locale)}</button>
            <button class="btn-ghost text-sm" onclick={() => { secondary = null; preview = null; }}>{tr({ en: 'Back', ar: 'رجوع' }, $locale)}</button>
          </div>
        </div>
      {:else}
        <!-- Pick the duplicate -->
        <input class="input mb-2" bind:value={search} oninput={searchPeople} placeholder={tr({ en: 'Search the duplicate by name…', ar: 'ابحث عن النسخة المكررة بالاسم…' }, $locale)} />
        {#if loading}
          <p class="text-sm text-slate-400">…</p>
        {:else if candidates.length}
          {#if !search.trim()}<p class="mb-1 text-xs text-amber-600 dark:text-amber-400">{tr({ en: 'Same-name matches:', ar: 'تطابقات بنفس الاسم:' }, $locale)}</p>{/if}
          <ul class="max-h-64 space-y-1 overflow-y-auto">
            {#each candidates as p (p.id)}
              <li>
                <button type="button" class="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-start text-sm hover:border-slate-400 dark:border-slate-700" onclick={() => pick(p)}>
                  <span><span class="font-medium">{name(p)}</span> <span class="text-slate-400">#{p.id}</span>{#if p.email || p.mobile} <span class="force-ltr text-xs text-slate-400">· {p.email || p.mobile}</span>{/if}</span>
                  <span class="text-xs" style="color: var(--brand)">{tr({ en: 'review →', ar: 'مراجعة →' }, $locale)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-slate-400">{tr({ en: 'No matches. Type a name to search.', ar: 'لا تطابقات. اكتب اسماً للبحث.' }, $locale)}</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}
