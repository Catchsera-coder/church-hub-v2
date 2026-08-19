<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ScheduleEditor from '$lib/components/ScheduleEditor.svelte';
  import { type Schedule, describeSchedule } from '$lib/schedule.js';

  interface Automation {
    id: number; type: string; enabled: boolean; mode: 'auto' | 'manual';
    channel: 'email' | 'sms' | 'whatsapp'; templateId: number | null;
    config: Record<string, number | string>; schedule: Schedule; lastRunOn: string | null;
  }

  // Mirrors backend defaultAutomationSchedule — weekly for absence nudges, daily otherwise.
  const defaultFor = (type: string): Schedule =>
    type === 'absence_followup'
      ? { mode: 'recurring', frequency: 'weekly', daysOfWeek: [1], time: '09:00' }
      : { mode: 'recurring', frequency: 'daily', time: '08:00' };

  const META: Record<string, { icon: string; title: Record<string, string>; desc: Record<string, string>; triggered?: boolean }> = {
    birthday: { icon: '🎂', title: { en: 'Birthday greeting', ar: 'تهنئة عيد الميلاد' }, desc: { en: "Sends on each member's birthday (needs date of birth).", ar: 'يُرسل في عيد ميلاد كل عضو (يتطلب تاريخ الميلاد).' } },
    join_anniversary: { icon: '🎉', title: { en: 'Membership anniversary', ar: 'ذكرى الانضمام' }, desc: { en: 'Sends yearly on their join date.', ar: 'يُرسل سنوياً في تاريخ انضمامهم.' } },
    first_visit_anniversary: { icon: '⭐', title: { en: 'First-visit anniversary', ar: 'ذكرى أول زيارة' }, desc: { en: 'Sends yearly on the anniversary of their first check-in.', ar: 'يُرسل سنوياً في ذكرى أول تسجيل حضور.' } },
    welcome: { icon: '👋', title: { en: 'Welcome message', ar: 'رسالة ترحيب' }, desc: { en: 'Sent when you approve a new / self-registered member.', ar: 'يُرسل عند الموافقة على عضو جديد / مسجّل ذاتياً.' }, triggered: true },
    absence_followup: { icon: '💜', title: { en: 'We miss you', ar: 'نفتقدك' }, desc: { en: "Reaches out to members who haven't attended in a while.", ar: 'يتواصل مع الأعضاء الذين لم يحضروا منذ فترة.' } },
  };

  let items = $state<Automation[]>([]);
  let templates = $state<any[]>([]);
  let loading = $state(true);
  let previews = $state<Record<number, number>>({});
  let runResult = $state<Record<number, string>>({});
  let busy = $state<number | null>(null);

  async function load() {
    loading = true;
    try {
      const [a, tpl] = await Promise.all([
        api<{ data: Automation[] }>('/automations'),
        api<{ data: any[] }>('/message-templates'),
      ]);
      items = a.data.map((it) => ({ ...it, schedule: it.schedule ?? defaultFor(it.type) }));
      templates = tpl.data;
      for (const it of items) if (!META[it.type]?.triggered) loadPreview(it.id);
    } finally { loading = false; }
  }

  async function saveSchedule(it: Automation) {
    scheduleSaved[it.id] = false;
    try { await api(`/automations/${it.id}`, { method: 'PUT', body: JSON.stringify({ schedule: it.schedule }) }); scheduleSaved[it.id] = true; }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
  }
  let scheduleSaved = $state<Record<number, boolean>>({});

  async function loadPreview(id: number) {
    try { previews[id] = (await api<{ data: { count: number } }>(`/automations/${id}/preview`)).data.count; } catch { /* ignore */ }
  }

  async function patch(it: Automation, changes: Partial<Automation>) {
    Object.assign(it, changes);
    items = items; // trigger reactivity
    try { await api(`/automations/${it.id}`, { method: 'PUT', body: JSON.stringify(changes) }); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
  }

  async function runNow(it: Automation) {
    const n = previews[it.id];
    if (!confirm(tr({ en: `Send this message now to ${n ?? 'all'} matching people?`, ar: `إرسال هذه الرسالة الآن إلى ${n ?? 'كل'} مطابق؟` }, $locale))) return;
    busy = it.id; runResult[it.id] = '';
    try {
      const r = await api<{ data: { sent: number; total: number } }>(`/automations/${it.id}/run`, { method: 'POST' });
      runResult[it.id] = tr({ en: `Sent ${r.data.sent} of ${r.data.total}`, ar: `أُرسل ${r.data.sent} من ${r.data.total}` }, $locale);
    } catch (err) { runResult[it.id] = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = null; }
  }

  onMount(load);
</script>

<PageHeader title={tr({ en: 'Automations', ar: 'الأتمتة' }, $locale)} />
<p class="mb-6 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
  {tr({ en: 'Automatic, branded messages for key moments. Turn each on or off, choose Automatic (sent for you) or Manual (you send when ready), pick the channel and template.', ar: 'رسائل تلقائية بعلامتكم للحظات المهمة. فعّل كلاً منها أو أوقفه، واختر تلقائي (يُرسل نيابةً عنك) أو يدوي (ترسله عند الجاهزية)، وحدّد القناة والقالب.' }, $locale)}
</p>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    {#each items as it (it.id)}
      {@const m = META[it.type] ?? { icon: '⚙️', title: { en: it.type }, desc: { en: '' } }}
      <div class="card p-5 {it.enabled ? '' : 'opacity-70'}">
        <div class="flex items-start justify-between gap-3">
          <div class="flex gap-3">
            <span class="text-2xl">{m.icon}</span>
            <div>
              <p class="font-semibold text-slate-900 dark:text-white">{tr(m.title, $locale)}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{tr(m.desc, $locale)}</p>
            </div>
          </div>
          <!-- Enable toggle -->
          <button
            role="switch" aria-checked={it.enabled}
            class="relative h-6 w-11 shrink-0 rounded-full transition {it.enabled ? '' : 'bg-slate-300 dark:bg-slate-600'}"
            style={it.enabled ? 'background-color: var(--brand)' : ''}
            onclick={() => patch(it, { enabled: !it.enabled })}
          >
            <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all {it.enabled ? 'start-[22px]' : 'start-0.5'}"></span>
          </button>
        </div>

        {#if it.enabled}
          <div class="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="text-sm">
                <span class="mb-1 block text-slate-500">{tr({ en: 'Mode', ar: 'الوضع' }, $locale)}</span>
                <select class="input" value={it.mode} onchange={(e) => patch(it, { mode: (e.currentTarget as HTMLSelectElement).value as any })}>
                  <option value="auto">{tr({ en: 'Automatic', ar: 'تلقائي' }, $locale)}</option>
                  <option value="manual">{tr({ en: 'Manual', ar: 'يدوي' }, $locale)}</option>
                </select>
              </label>
              <label class="text-sm">
                <span class="mb-1 block text-slate-500">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</span>
                <select class="input" value={it.channel} onchange={(e) => patch(it, { channel: (e.currentTarget as HTMLSelectElement).value as any })}>
                  <option value="email">{tr({ en: 'Email', ar: 'بريد' }, $locale)}</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">{tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</option>
                </select>
              </label>
            </div>
            <label class="block text-sm">
              <span class="mb-1 block text-slate-500">{tr({ en: 'Template', ar: 'القالب' }, $locale)}</span>
              <select class="input" value={it.templateId ?? ''} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; patch(it, { templateId: v ? Number(v) : null }); }}>
                <option value="">{tr({ en: '— Choose a template —', ar: '— اختر قالباً —' }, $locale)}</option>
                {#each templates as tp}<option value={tp.id}>{tp.name}</option>{/each}
              </select>
              {#if !it.templateId}<span class="text-xs text-amber-600 dark:text-amber-400">{tr({ en: 'Pick a template so this can send.', ar: 'اختر قالباً حتى يتمكن من الإرسال.' }, $locale)}</span>{/if}
            </label>

            {#if it.type === 'absence_followup'}
              <label class="block text-sm">
                <span class="mb-1 block text-slate-500">{tr({ en: 'Not seen for (weeks)', ar: 'لم يُشاهد منذ (أسابيع)' }, $locale)}</span>
                <input class="input force-ltr w-28" type="number" min="1" max="52" value={it.config?.absenceWeeks ?? 4}
                  onchange={(e) => { patch(it, { config: { ...it.config, absenceWeeks: Number((e.currentTarget as HTMLInputElement).value) || 4 } }); loadPreview(it.id); }} />
              </label>
            {/if}

            <!-- When it runs (auto mode) — the reusable schedule editor -->
            {#if it.mode === 'auto' && !m.triggered && it.schedule}
              <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p class="mb-2 text-sm font-medium">🕑 {tr({ en: 'When it runs', ar: 'متى يعمل' }, $locale)}</p>
                <ScheduleEditor bind:schedule={it.schedule} showOnce={false} />
                <div class="mt-2 flex items-center gap-2">
                  <button type="button" class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => saveSchedule(it)}>{tr({ en: 'Save timing', ar: 'حفظ التوقيت' }, $locale)}</button>
                  {#if scheduleSaved[it.id]}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓</span>{/if}
                </div>
              </div>
            {/if}

            <div class="flex flex-wrap items-center gap-3 pt-1">
              {#if m.triggered}
                <span class="text-xs text-slate-500">{tr({ en: it.mode === 'auto' ? 'Sends automatically when a member is approved.' : 'Offered as an option when you approve a member.', ar: it.mode === 'auto' ? 'يُرسل تلقائياً عند الموافقة على عضو.' : 'يُعرض كخيار عند الموافقة على عضو.' }, $locale)}</span>
              {:else}
                <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {previews[it.id] ?? '…'} {tr({ en: 'match now', ar: 'مطابق الآن' }, $locale)}
                </span>
                <button class="btn-ghost text-sm" disabled={!it.templateId || busy === it.id} onclick={() => runNow(it)}>
                  {busy === it.id ? '…' : tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}
                </button>
                {#if it.mode === 'auto' && it.schedule}<span class="text-xs text-slate-400">{describeSchedule(it.schedule)}</span>{/if}
              {/if}
              {#if runResult[it.id]}<span class="text-xs text-emerald-600 dark:text-emerald-400">{runResult[it.id]}</span>{/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
