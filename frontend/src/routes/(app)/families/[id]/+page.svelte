<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, tr, locale } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import FamilyForm from '$lib/components/FamilyForm.svelte';
  import FamilyMembers from '$lib/components/FamilyMembers.svelte';

  const id = Number($page.params.id);
  let family = $state<any>(null);
  let members = $state<any[]>([]);
  let loading = $state(true);
  let editingFamily = $state(false);
  const canMessage = can('create message');

  async function loadFamily() { family = (await api<{ data: any }>(`/families/${id}`)).data; }
  async function loadMembers() { members = (await api<{ data: any[] }>(`/families/${id}/members`)).data; }

  onMount(async () => {
    try { await Promise.all([loadFamily(), loadMembers()]); } finally { loading = false; }
  });

  // ---- derived family stats (single source of truth: the members array) -------
  function ageOf(dob: string | null | undefined): number | null {
    if (!dob) return null;
    const d = new Date(dob); if (isNaN(+d)) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }
  const stats = $derived.by(() => {
    let adults = 0, children = 0, unknown = 0;
    for (const m of members) {
      const a = ageOf(m.dateOfBirth);
      if (a == null) unknown++;
      else if (a < 18) children++;
      else adults++;
    }
    return { total: members.length, adults, children, unknown };
  });
  const addr = $derived.by(() => {
    if (!family) return '';
    return [family.addressLine1, family.addressLine2, family.city, family.region, family.postalCode, family.country]
      .filter(Boolean).join(', ');
  });
  const familyPhone = $derived(family?.homePhone || members.find((m) => m.mobile)?.mobile || '');

  async function messageFamily() {
    const ids = members.map((m) => m.id);
    if (!ids.length) return;
    await goto(`/messages/new?people=${ids.join(',')}`);
  }
  async function onFamilySaved() { editingFamily = false; await loadFamily(); }
</script>

<PageHeader title={family ? tr(family.name, $locale) || tr({ en: 'Family', ar: 'عائلة' }, $locale) : tr({ en: 'Family', ar: 'عائلة' }, $locale)} back="/families">
  {#snippet actions()}
    {#if canMessage && members.length}
      <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={messageFamily}>✉️ {tr({ en: 'Message family', ar: 'راسل العائلة' }, $locale)}</button>
    {/if}
    {#if can('update household')}
      <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => (editingFamily = !editingFamily)}>
        {editingFamily ? tr({ en: '✕ Close details', ar: '✕ إغلاق التفاصيل' }, $locale) : tr({ en: '✎ Edit details', ar: '✎ تعديل التفاصيل' }, $locale)}
      </button>
    {/if}
  {/snippet}
</PageHeader>

<PageHint id="family-detail" text={{ en: 'Edit any family member right here — tap the ✏️ on their card. Add members by searching existing people or quick-adding new ones. "Edit details" (top right) changes the family address & phone.', ar: 'عدّل أي فرد من العائلة هنا — اضغط ✏️ على بطاقته. أضف أفراداً بالبحث عن أشخاص موجودين أو إضافة جدد. «تعديل التفاصيل» يغيّر عنوان وهاتف العائلة.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if family}
  <!-- Summary header -->
  <div class="card mb-6 p-5 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex items-center gap-4">
        <span class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl" style="background: color-mix(in srgb, var(--brand) 15%, transparent)">🏠</span>
        <div>
          <h1 class="text-xl font-semibold">{tr(family.name, $locale) || tr({ en: 'Unnamed family', ar: 'عائلة بدون اسم' }, $locale)}</h1>
          {#if addr}<p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">📍 {addr}</p>{/if}
          {#if familyPhone}<p class="force-ltr mt-0.5 text-sm text-slate-500 dark:text-slate-400"><a href="tel:{familyPhone}" class="hover:underline">📞 {familyPhone}</a></p>{/if}
        </div>
      </div>
      <!-- stat chips -->
      <div class="flex flex-wrap gap-2">
        <div class="rounded-xl bg-slate-100 px-3 py-2 text-center dark:bg-slate-800">
          <div class="text-lg font-semibold leading-none">{stats.total}</div>
          <div class="mt-1 text-xs text-slate-500">{tr({ en: 'Members', ar: 'أفراد' }, $locale)}</div>
        </div>
        <div class="rounded-xl bg-slate-100 px-3 py-2 text-center dark:bg-slate-800">
          <div class="text-lg font-semibold leading-none">{stats.adults}</div>
          <div class="mt-1 text-xs text-slate-500">{tr({ en: 'Adults', ar: 'بالغون' }, $locale)}</div>
        </div>
        <div class="rounded-xl bg-slate-100 px-3 py-2 text-center dark:bg-slate-800">
          <div class="text-lg font-semibold leading-none">{stats.children}</div>
          <div class="mt-1 text-xs text-slate-500">{tr({ en: 'Children', ar: 'أطفال' }, $locale)}</div>
        </div>
      </div>
    </div>

    <!-- gentle completeness nudges — click to add the missing field right here -->
    {#if !addr || !familyPhone || stats.total === 0}
      <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {#if stats.total === 0}<span class="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{tr({ en: 'No members yet', ar: 'لا أفراد بعد' }, $locale)}</span>{/if}
        {#if can('update household') && (!addr || !familyPhone)}
          {#if !addr}<button type="button" class="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40" onclick={() => (editingFamily = true)}>+ {tr({ en: 'Add address', ar: 'أضف العنوان' }, $locale)}</button>{/if}
          {#if !familyPhone}<button type="button" class="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40" onclick={() => (editingFamily = true)}>+ {tr({ en: 'Add phone', ar: 'أضف الهاتف' }, $locale)}</button>{/if}
        {:else}
          {#if !addr}<span class="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{tr({ en: 'Missing address', ar: 'العنوان ناقص' }, $locale)}</span>{/if}
          {#if !familyPhone}<span class="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{tr({ en: 'No phone on file', ar: 'لا يوجد هاتف' }, $locale)}</span>{/if}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Collapsible family-details editor -->
  {#if editingFamily}
    <div class="mb-6">
      <FamilyForm initial={family} {id} redirect={false} onsaved={onFamilySaved} />
    </div>
  {/if}

  <!-- Members roster (rich, inline-editable) -->
  <FamilyMembers householdId={id} {members} onchanged={loadMembers} />
{:else}
  <p class="text-slate-400">{tr({ en: 'Family not found.', ar: 'العائلة غير موجودة.' }, $locale)}</p>
{/if}
