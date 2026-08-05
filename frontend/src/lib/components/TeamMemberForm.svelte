<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let allRoles = $state<any[]>([]);
  let form = $state({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    isActive: initial?.isActive ?? true,
    roleIds: [] as number[],
  });
  let error = $state('');
  let saving = $state(false);

  onMount(async () => {
    allRoles = (await api<{ data: any[] }>('/team/roles')).data;
    // Edit: the list returns role *names*; map them back to ids for the checkboxes.
    if (initial?.roles?.length) {
      form.roleIds = allRoles.filter((r) => initial.roles.includes(r.name)).map((r) => r.id);
    }
  });

  function toggleRole(rid: number) {
    form.roleIds = form.roleIds.includes(rid) ? form.roleIds.filter((x) => x !== rid) : [...form.roleIds, rid];
  }

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      if (id) {
        await api(`/team/${id}`, { method: 'PUT', body: JSON.stringify({ name: form.name, isActive: form.isActive, roleIds: form.roleIds }) });
      } else {
        await api('/team', { method: 'POST', body: JSON.stringify({ name: form.name, email: form.email, password: form.password || undefined, roleIds: form.roleIds }) });
      }
      await goto('/team');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</span>
      <input class="input" bind:value={form.name} required />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد الإلكتروني' }, $locale)}</span>
      <input class="input force-ltr" type="email" bind:value={form.email} required disabled={!!id} />
    </label>

    {#if !id}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Temporary password', ar: 'كلمة مرور مؤقتة' }, $locale)}</span>
        <input class="input force-ltr" type="text" bind:value={form.password} minlength="8" placeholder={tr({ en: 'Leave blank to invite by email', ar: 'اتركه فارغاً للدعوة بالبريد' }, $locale)} />
        <span class="text-xs text-slate-400">{tr({ en: 'If set, at least 8 characters. If blank, the person is marked invited.', ar: 'إن حُدّدت، 8 أحرف على الأقل. إن تُركت فارغة، يُعلَّم الشخص كمدعو.' }, $locale)}</span>
      </label>
    {/if}

    <fieldset class="space-y-2">
      <legend class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Roles', ar: 'الأدوار' }, $locale)}</legend>
      <div class="grid grid-cols-2 gap-2">
        {#each allRoles as r}
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.roleIds.includes(r.id)} onchange={() => toggleRole(r.id)} /> {r.name}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if id}
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active', ar: 'نشط' }, $locale)}</label>
    {/if}
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/team">✕</a>
  </div>
</form>
