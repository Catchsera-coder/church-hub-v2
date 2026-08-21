<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MemberForm from '$lib/components/MemberForm.svelte';
  import RosterEditor from '$lib/components/RosterEditor.svelte';
  import MemberClearances from '$lib/components/MemberClearances.svelte';
  import MemberCare from '$lib/components/MemberCare.svelte';
  import MemberQrCard from '$lib/components/MemberQrCard.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  const STAGES = [
    { v: '', en: '— none —', ar: '— بدون —' },
    { v: 'new_visitor', en: 'New / first-time', ar: 'جديد / أول مرة' },
    { v: 'contacted', en: 'Contacted', ar: 'تم التواصل' },
    { v: 'connected', en: 'Connected', ar: 'مندمج' },
    { v: 'regular', en: 'Regular', ar: 'منتظم' },
    { v: 'member', en: 'Member', ar: 'عضو' },
  ];
  async function setStage(stage: string) {
    try { await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify({ followUpStage: stage || null }) }); if (person) person.followUpStage = stage || null; }
    catch (err) { alert((err as Error).message); }
  }

  let person = $state<any>(null);
  let id = $state<number>(Number($page.params.id));
  let busy = $state(false);
  let confirmDel = $state(false);
  let deleting = $state(false);

  async function reload() { person = (await api<{ data: any }>(`/people/${id}`)).data; }
  onMount(reload);

  async function archive() {
    busy = true;
    try { await api(`/people/${id}/archive`, { method: 'POST' }); await reload(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = false; }
  }
  async function unarchive() {
    busy = true;
    try { await api(`/people/${id}/unarchive`, { method: 'POST' }); await reload(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = false; }
  }
  async function doDelete() {
    deleting = true;
    try { await api(`/people/${id}`, { method: 'DELETE' }); await goto('/members'); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); deleting = false; }
  }
</script>

<PageHeader title={`${tr({ en: 'Edit member', ar: 'تعديل العضو' }, $locale)} · #${id}`} back="/members">
  {#snippet actions()}
    {#if person?.householdId}
      <a class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" href="/families/{person.householdId}">👪 {tr({ en: 'Open family', ar: 'فتح العائلة' }, $locale)}</a>
    {/if}
    {#if person && can('update person')}
      {#if person.archivedAt}
        <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={unarchive} disabled={busy}>♻️ {tr({ en: 'Unarchive', ar: 'إلغاء الأرشفة' }, $locale)}</button>
      {:else}
        <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={archive} disabled={busy}>🗄 {tr({ en: 'Archive', ar: 'أرشفة' }, $locale)}</button>
      {/if}
    {/if}
    {#if person && can('delete person')}
      <button class="btn-ghost border border-rose-300 text-sm text-rose-600 dark:border-rose-800 dark:text-rose-400" onclick={() => (confirmDel = true)}>🗑 {tr({ en: 'Delete', ar: 'حذف' }, $locale)}</button>
    {/if}
  {/snippet}
</PageHeader>

{#if person}
  {#if person.archivedAt}
    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800">
      <span>🗄 {tr({ en: 'This member is archived — excluded from lists, ministry rosters and all messaging until you un-archive them.', ar: 'هذا العضو مؤرشف — مستبعد من القوائم وفرق الخدمة وكل المراسلات حتى تُلغي الأرشفة.' }, $locale)}</span>
      {#if can('update person')}<button class="ms-auto text-primary-700 hover:underline dark:text-primary-300" onclick={unarchive} disabled={busy}>{tr({ en: 'Unarchive', ar: 'إلغاء الأرشفة' }, $locale)}</button>{/if}
    </div>
  {/if}
  <div class="grid gap-6 lg:grid-cols-5 lg:items-start">
    <div class="lg:col-span-3"><MemberForm initial={person} {id} /></div>
    <div class="space-y-6 lg:col-span-2">
      {#if can('update person')}
        <div class="card p-4">
          <label class="block space-y-1">
            <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">🧭 {tr({ en: 'Follow-up stage', ar: 'مرحلة المتابعة' }, $locale)}</span>
            <select class="input" value={person.followUpStage ?? ''} onchange={(e) => setStage((e.currentTarget as HTMLSelectElement).value)}>
              {#each STAGES as s}<option value={s.v}>{tr({ en: s.en, ar: s.ar }, $locale)}</option>{/each}
            </select>
          </label>
        </div>
      {/if}
      <MemberCare personId={id} />
      <RosterEditor personId={id} />
      <MemberClearances personId={id} />
      {#if person.qrToken}
        <MemberQrCard qrToken={person.qrToken} name={`${tr(person.givenName, $locale)} ${tr(person.familyName, $locale)}`.trim()} />
      {/if}
    </div>
  </div>
{:else}
  <p class="text-slate-400">{$t('common.loading')}</p>
{/if}

<ConfirmDialog open={confirmDel} danger
  title={tr({ en: 'Delete this member?', ar: 'حذف هذا العضو؟' }, $locale)}
  message={tr({ en: "This removes them from the directory. Their name is kept only where it must resolve historical giving records. This can't be undone — to hide someone temporarily, use Archive instead.", ar: 'سيؤدي هذا إلى إزالته من الدليل. يُحتفظ باسمه فقط حيث يلزم لسجلات العطاء التاريخية. لا يمكن التراجع — لإخفاء شخص مؤقتاً استخدم الأرشفة.' }, $locale)}
  confirmLabel={tr({ en: 'Delete', ar: 'حذف' }, $locale)} busy={deleting}
  onconfirm={doDelete} oncancel={() => (confirmDel = false)} />
