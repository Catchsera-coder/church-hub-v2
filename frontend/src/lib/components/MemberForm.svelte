<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let families = $state<any[]>([]);
  let form = $state({
    givenName: initial?.givenName ?? {},
    familyName: initial?.familyName ?? {},
    householdId: initial?.householdId ? String(initial.householdId) : '',
    membershipStatus: initial?.membershipStatus ?? 'visitor',
    email: initial?.email ?? '',
    mobile: initial?.mobile ?? '',
    preferredLanguage: initial?.preferredLanguage ?? 'en',
    dateOfBirth: initial?.dateOfBirth ?? '',
    joinedOn: initial?.joinedOn ?? '',
    isActive: initial?.isActive ?? true,
    emailOptOut: initial?.emailOptOut ?? false,
    smsOptOut: initial?.smsOptOut ?? false,
    whatsappOptOut: initial?.whatsappOptOut ?? false,
  });
  let saving = $state(false);
  let error = $state('');

  // Inline "quick create" for a family, so the admin never has to leave this form.
  let showNewFamily = $state(false);
  let newFamilyName = $state('');
  let creatingFamily = $state(false);

  const statuses = ['visitor', 'regular', 'member', 'inactive'];

  onMount(async () => {
    families = (await api<{ data: any[] }>('/families?limit=100')).data;
    // Ensure the member's current family stays selectable even if it's not in
    // the newest 100 (else the link could silently drop on save).
    const hid = initial?.householdId;
    if (hid && !families.some((f) => f.id === hid)) {
      try {
        const { data } = await api<{ data: any }>(`/families/${hid}`);
        if (data) families = [data, ...families];
      } catch { /* household may be gone; leave as-is */ }
    }
  });

  async function createFamily() {
    if (!newFamilyName.trim()) return;
    creatingFamily = true;
    try {
      const { data } = await api<{ data: any }>('/families', {
        method: 'POST',
        body: JSON.stringify({ name: { en: newFamilyName.trim() } }),
      });
      families = [...families, data];
      form.householdId = String(data.id);
      showNewFamily = false;
      newFamilyName = '';
    } catch (err) {
      error = (err as Error).message;
    } finally { creatingFamily = false; }
  }

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = {
        ...form,
        householdId: form.householdId === '' ? null : Number(form.householdId),
        email: form.email || null,
        mobile: form.mobile || null,
        dateOfBirth: form.dateOfBirth || null,
        joinedOn: form.joinedOn || null,
      };
      if (id) await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/people', { method: 'POST', body: JSON.stringify(body) });
      await goto('/members');
    } catch (err) {
      error = (err as Error).message;
    } finally { saving = false; }
  }
</script>

<form class="max-w-2xl space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    {#each $enabledLocales as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.givenName[l.code]} required={l.code === 'en'} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.familyName[l.code]} />
      </label>
    {/each}
  </div>

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
      <select class="input capitalize" bind:value={form.membershipStatus}>{#each statuses as s}<option value={s}>{s}</option>{/each}</select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Preferred language', ar: 'اللغة المفضلة' }, $locale)}</span>
      <select class="input" bind:value={form.preferredLanguage}>{#each $enabledLocales as l}<option value={l.code}>{l.native}</option>{/each}</select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span>
      <input class="input force-ltr" type="email" bind:value={form.email} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</span>
      <input class="input force-ltr" bind:value={form.mobile} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">🎂 {tr({ en: 'Date of birth', ar: 'تاريخ الميلاد' }, $locale)}</span>
      <input class="input force-ltr" type="date" bind:value={form.dateOfBirth} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">🎉 {tr({ en: 'Joined the church', ar: 'تاريخ الانضمام' }, $locale)}</span>
      <input class="input force-ltr" type="date" bind:value={form.joinedOn} />
    </label>
    <div class="block space-y-1 sm:col-span-2">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Family', ar: 'العائلة' }, $locale)}</span>
      {#if showNewFamily}
        <div class="flex gap-2">
          <input class="input" bind:value={newFamilyName} placeholder={tr({ en: 'New family name', ar: 'اسم عائلة جديد' }, $locale)} />
          <button type="button" class="btn-primary shrink-0" onclick={createFamily} disabled={creatingFamily}>{creatingFamily ? '…' : tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button>
          <button type="button" class="btn-ghost shrink-0" onclick={() => { showNewFamily = false; }}>✕</button>
        </div>
      {:else}
        <div class="flex gap-2">
          <select class="input" bind:value={form.householdId}>
            <option value="">{tr({ en: '— None —', ar: '— بدون —' }, $locale)}</option>
            {#each families as f}<option value={String(f.id)}>{tr(f.name, $locale)}</option>{/each}
          </select>
          {#if can('create household')}<button type="button" class="btn-ghost shrink-0 whitespace-nowrap" onclick={() => { showNewFamily = true; }}>+ {tr({ en: 'New', ar: 'جديد' }, $locale)}</button>{/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="card space-y-3 p-6">
    <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">{tr({ en: 'Messaging consent', ar: 'موافقة المراسلة' }, $locale)}</h2>
    <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'When ticked, this person will NOT receive that channel (they opted out).', ar: 'عند التحديد، لن يتلقى هذا الشخص تلك القناة (انسحب).' }, $locale)}</p>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.emailOptOut} /> {tr({ en: 'Opted out of email', ar: 'منسحب من البريد' }, $locale)}</label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.smsOptOut} /> {tr({ en: 'Opted out of SMS', ar: 'منسحب من الرسائل النصية' }, $locale)}</label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.whatsappOptOut} /> {tr({ en: 'Opted out of WhatsApp', ar: 'منسحب من واتساب' }, $locale)}</label>
  </div>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/members">✕</a>
  </div>
</form>
