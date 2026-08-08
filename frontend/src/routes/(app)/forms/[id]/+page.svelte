<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import * as QRCode from 'qrcode';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  type Field = { key: string; label: Record<string, string>; type: string; required: boolean; forWhom: 'primary' | 'all'; options?: string[] };
  const id = Number($page.params.id);

  let form = $state<any>(null);
  let saving = $state(false);
  let saved = $state(false);
  let confirmDelete = $state(false);
  let deleting = $state(false);
  let qrDataUrl = $state('');

  const TYPES = ['text', 'tel', 'email', 'date', 'select', 'checkbox'];
  const STANDARD = [
    { key: 'givenName', label: { en: 'First name', ar: 'الاسم الأول' }, type: 'text' },
    { key: 'familyName', label: { en: 'Last name', ar: 'اسم العائلة' }, type: 'text' },
    { key: 'mobile', label: { en: 'Mobile', ar: 'الجوال' }, type: 'tel' },
    { key: 'email', label: { en: 'Email', ar: 'البريد' }, type: 'email' },
    { key: 'dateOfBirth', label: { en: 'Date of birth', ar: 'تاريخ الميلاد' }, type: 'date' },
    { key: 'householdRole', label: { en: 'Relationship', ar: 'صلة القرابة' }, type: 'text' },
  ];

  const shareUrl = $derived(form && typeof window !== 'undefined' ? `${window.location.origin}/checkin/form/${form.publicToken}` : '');

  onMount(async () => {
    form = (await api<{ data: any }>(`/checkin-forms/${id}`)).data;
    if (!form.fields) form.fields = [];
  });

  $effect(() => {
    const url = shareUrl;
    if (!url) { qrDataUrl = ''; return; }
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then((d) => (qrDataUrl = d)).catch(() => (qrDataUrl = ''));
  });

  function addStandard(s: typeof STANDARD[number]) {
    if (form.fields.some((f: Field) => f.key === s.key)) return;
    form.fields = [...form.fields, { key: s.key, label: s.label, type: s.type, required: false, forWhom: 'all' }];
  }
  function addCustom() {
    const n = form.fields.filter((f: Field) => f.key.startsWith('custom')).length + 1;
    form.fields = [...form.fields, { key: `custom${n}`, label: { en: 'Custom field' }, type: 'text', required: false, forWhom: 'all' }];
  }
  function remove(i: number) { form.fields = form.fields.filter((_: Field, idx: number) => idx !== i); }
  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= form.fields.length) return;
    const next = [...form.fields];
    [next[i], next[j]] = [next[j], next[i]];
    form.fields = next;
  }
  function optionsText(f: Field) { return (f.options ?? []).join(', '); }
  function setOptions(f: Field, v: string) { f.options = v.split(',').map((s) => s.trim()).filter(Boolean); }

  async function save() {
    saving = true; saved = false;
    try {
      await api(`/checkin-forms/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name, intro: form.intro, fields: form.fields,
          showFamily: form.showFamily, showConsent: form.showConsent, active: form.active,
        }),
      });
      saved = true;
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { saving = false; }
  }

  async function duplicate() {
    const { data } = await api<{ data: any }>(`/checkin-forms/${id}/duplicate`, { method: 'POST' });
    await goto(`/forms/${data.id}`);
  }

  async function doDelete() {
    deleting = true;
    try { await api(`/checkin-forms/${id}`, { method: 'DELETE' }); await goto('/forms'); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); deleting = false; }
  }

  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: tr(form.name, $locale), url: shareUrl }); return; }
      await navigator.clipboard.writeText(shareUrl);
      alert(tr({ en: 'Link copied.', ar: 'تم نسخ الرابط.' }, $locale));
    } catch { /* cancelled */ }
  }
</script>

<PageHeader title={tr({ en: 'Edit form', ar: 'تعديل النموذج' }, $locale)} back="/forms">
  {#snippet actions()}
    <button class="btn-ghost" onclick={duplicate}>{tr({ en: 'Duplicate', ar: 'نسخ' }, $locale)}</button>
    {#if form && !form.isDefault}<button class="btn-ghost text-rose-600 dark:text-rose-400" onclick={() => (confirmDelete = true)}>{$t('common.delete')}</button>{/if}
    <button class="btn-primary" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    {#if saved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
  {/snippet}
</PageHeader>

{#if !form}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="grid gap-6 lg:grid-cols-3">
    <!-- Builder -->
    <div class="space-y-4 lg:col-span-2">
      <div class="card space-y-3 p-4">
        {#each $enabledLocales as l}
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Form name', ar: 'اسم النموذج' }, $locale)} ({l.native})</span>
            <input class="input" dir={l.dir} bind:value={form.name[l.code]} />
          </label>
        {/each}
        {#each $enabledLocales as l}
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Intro text', ar: 'نص ترحيبي' }, $locale)} ({l.native})</span>
            <input class="input" dir={l.dir} bind:value={form.intro[l.code]} />
          </label>
        {/each}
        <div class="flex flex-wrap gap-4 pt-1 text-sm">
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={form.active} /> {tr({ en: 'Active', ar: 'مفعّل' }, $locale)}</label>
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={form.showFamily} /> {tr({ en: 'Allow adding family', ar: 'السماح بإضافة العائلة' }, $locale)}</label>
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={form.showConsent} /> {tr({ en: 'Show consent options', ar: 'إظهار خيارات الموافقة' }, $locale)}</label>
        </div>
      </div>

      <div class="card p-4">
        <p class="mb-3 font-semibold">{tr({ en: 'Fields', ar: 'الحقول' }, $locale)}</p>
        <div class="space-y-3">
          {#each form.fields as f, i}
            <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div class="mb-2 flex items-center gap-2">
                <input class="input flex-1" bind:value={f.label.en} placeholder={tr({ en: 'Label', ar: 'التسمية' }, $locale)} />
                <button type="button" class="btn-ghost px-2" onclick={() => move(i, -1)} aria-label="up">↑</button>
                <button type="button" class="btn-ghost px-2" onclick={() => move(i, 1)} aria-label="down">↓</button>
                <button type="button" class="px-2 text-rose-500" onclick={() => remove(i)} aria-label="remove">✕</button>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-sm">
                <select class="input w-28" bind:value={f.type}>{#each TYPES as ty}<option value={ty}>{ty}</option>{/each}</select>
                <select class="input w-32" bind:value={f.forWhom}>
                  <option value="all">{tr({ en: 'Everyone', ar: 'الجميع' }, $locale)}</option>
                  <option value="primary">{tr({ en: 'Main person', ar: 'الشخص الرئيسي' }, $locale)}</option>
                </select>
                <label class="flex items-center gap-1"><input type="checkbox" bind:checked={f.required} /> {tr({ en: 'Required', ar: 'مطلوب' }, $locale)}</label>
                <span class="text-xs text-slate-400">{tr({ en: 'key', ar: 'مفتاح' }, $locale)}: {f.key}</span>
              </div>
              {#if f.type === 'select'}
                <input class="input mt-2 text-sm" value={optionsText(f)} oninput={(e) => setOptions(f, (e.currentTarget as HTMLInputElement).value)} placeholder={tr({ en: 'Options, comma-separated', ar: 'الخيارات، مفصولة بفواصل' }, $locale)} />
              {/if}
            </div>
          {/each}
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          {#each STANDARD as s}
            <button type="button" class="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800" disabled={form.fields.some((x: Field) => x.key === s.key)} onclick={() => addStandard(s)}>+ {tr(s.label, $locale)}</button>
          {/each}
          <button type="button" class="rounded-full border border-dashed border-slate-400 px-3 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800" onclick={addCustom}>+ {tr({ en: 'Custom field', ar: 'حقل مخصص' }, $locale)}</button>
        </div>
      </div>
    </div>

    <!-- Preview + share -->
    <div class="space-y-4">
      <div class="card p-4">
        <p class="mb-2 text-sm font-semibold text-slate-500">{tr({ en: 'Live preview', ar: 'معاينة حية' }, $locale)}</p>
        <div class="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
          <p class="text-center font-bold">{tr(form.name, $locale)}</p>
          {#if tr(form.intro, $locale)}<p class="mb-3 text-center text-xs text-slate-500">{tr(form.intro, $locale)}</p>{/if}
          <div class="space-y-2">
            {#each form.fields as f}
              <div>
                <span class="text-xs text-slate-500">{f.label.en || f.key}{#if f.required}<span class="text-rose-500"> *</span>{/if}</span>
                {#if f.type === 'checkbox'}
                  <input type="checkbox" disabled class="ms-2" />
                {:else if f.type === 'select'}
                  <select class="input" disabled><option>—</option></select>
                {:else}
                  <input class="input" disabled type={f.type} />
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="card p-4 text-center">
        <p class="mb-2 text-sm font-semibold text-slate-500">{tr({ en: 'Share', ar: 'مشاركة' }, $locale)}</p>
        {#if qrDataUrl}<img src={qrDataUrl} alt="QR" class="mx-auto h-40 w-40 rounded-lg bg-white p-2" />{/if}
        <div class="mt-3 flex justify-center gap-2">
          <button class="btn-primary" onclick={share}>{tr({ en: 'Share link', ar: 'مشاركة الرابط' }, $locale)}</button>
          <a class="btn-ghost" href={shareUrl} target="_blank" rel="noopener">{tr({ en: 'Open', ar: 'فتح' }, $locale)}</a>
        </div>
        <p class="mt-2 break-all text-xs text-slate-400">{shareUrl}</p>
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog
  bind:open={confirmDelete}
  danger
  title={tr({ en: 'Delete this form?', ar: 'حذف هذا النموذج؟' }, $locale)}
  message={tr({ en: 'The share link and QR will stop working. This cannot be undone.', ar: 'سيتوقف الرابط ورمز QR عن العمل. لا يمكن التراجع.' }, $locale)}
  confirmLabel={$t('common.delete')}
  busy={deleting}
  onconfirm={doDelete}
/>
