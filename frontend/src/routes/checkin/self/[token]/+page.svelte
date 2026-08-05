<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t, locale, tr } from '$lib/i18n.js';

  const token = $page.params.token;
  const base = `/api/public/checkin/${token}`;

  let loading = $state(true);
  let event = $state<{ title: Record<string, string>; startsAt: string } | null>(null);
  let notActive = $state(false);

  let q = $state('');
  let searching = $state(false);
  let people = $state<{ id: number; name: string }[]>([]); // deduped candidates to tick
  let checked = $state<Set<number>>(new Set());
  let searched = $state(false);

  let newMembers = $state<{ givenName: string; familyName: string; isChild: boolean }[]>([]);

  let submitting = $state(false);
  let doneCount = $state<number | null>(null);
  let error = $state('');

  onMount(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) { notActive = true; return; }
      event = (await res.json()).data;
    } catch { notActive = true; } finally { loading = false; }
  });

  async function search(e: Event) {
    e.preventDefault();
    if (!q.trim()) return;
    searching = true; error = '';
    try {
      const res = await fetch(`${base}/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: q.trim() }),
      });
      const cards = (await res.json()).data as { id: number; name: string; household: { id: number; name: string }[] }[];
      // Flatten households into a unique person list; pre-tick the direct matches.
      const map = new Map<number, string>();
      const matches = new Set<number>();
      for (const c of cards) {
        matches.add(c.id);
        for (const m of c.household) map.set(m.id, m.name);
      }
      people = [...map].map(([id, name]) => ({ id, name }));
      checked = new Set(matches);
      searched = true;
    } catch { error = tr({ en: 'Search failed, try again.', ar: 'فشل البحث، حاول مجدداً.' }, $locale); } finally { searching = false; }
  }

  function toggle(id: number) {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    checked = next;
  }

  function addNew() { newMembers = [...newMembers, { givenName: '', familyName: '', isChild: false }]; }
  function removeNew(i: number) { newMembers = newMembers.filter((_, idx) => idx !== i); }

  async function submit() {
    const personIds = [...checked];
    const fresh = newMembers.filter((m) => m.givenName.trim());
    if (!personIds.length && !fresh.length) { error = tr({ en: 'Pick who is here, or add a name.', ar: 'اختر الحاضرين أو أضف اسماً.' }, $locale); return; }
    submitting = true; error = '';
    try {
      const res = await fetch(`${base}/record`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personIds, newMembers: fresh.map((m) => ({ givenName: m.givenName.trim(), familyName: m.familyName.trim(), isChild: m.isChild })) }),
      });
      if (!res.ok) throw new Error();
      doneCount = (await res.json()).data.checkedIn;
    } catch { error = tr({ en: 'Could not check in, try again.', ar: 'تعذّر التسجيل، حاول مجدداً.' }, $locale); } finally { submitting = false; }
  }

  function reset() {
    q = ''; people = []; checked = new Set(); searched = false; newMembers = []; doneCount = null; error = '';
  }
</script>

<div class="mx-auto flex min-h-full max-w-md flex-col px-4 py-8">
  {#if loading}
    <p class="mt-20 text-center text-slate-400">{$t('common.loading')}</p>
  {:else if notActive}
    <div class="card mt-16 p-8 text-center">
      <p class="text-lg font-medium">{tr({ en: 'This check-in link is not active.', ar: 'رابط التسجيل غير مُفعّل.' }, $locale)}</p>
      <p class="mt-2 text-sm text-slate-500">{tr({ en: 'Please ask a volunteer.', ar: 'يرجى سؤال أحد الخدام.' }, $locale)}</p>
    </div>
  {:else if doneCount !== null}
    <div class="card mt-16 p-8 text-center">
      <div class="mb-3 text-5xl">✓</div>
      <h1 class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{tr({ en: "You're checked in!", ar: 'تم تسجيل حضورك!' }, $locale)}</h1>
      <p class="mt-2 text-slate-600 dark:text-slate-300">{doneCount} {tr({ en: 'checked in. Welcome! 🙏', ar: 'مسجّل. أهلاً بكم! 🙏' }, $locale)}</p>
      <button class="btn-ghost mt-6" onclick={reset}>{tr({ en: 'Check in someone else', ar: 'تسجيل شخص آخر' }, $locale)}</button>
    </div>
  {:else}
    <header class="mb-6 text-center">
      <h1 class="text-2xl font-bold">{event ? tr(event.title, $locale) : ''}</h1>
      <p class="text-sm text-slate-500">{tr({ en: 'Find your name to check in', ar: 'ابحث عن اسمك للتسجيل' }, $locale)}</p>
    </header>

    <form class="mb-4 flex gap-2" onsubmit={search}>
      <input class="input text-base" bind:value={q} placeholder={tr({ en: 'Type your name…', ar: 'اكتب اسمك…' }, $locale)} />
      <button class="btn-primary shrink-0" type="submit" disabled={searching}>{searching ? '…' : tr({ en: 'Search', ar: 'بحث' }, $locale)}</button>
    </form>

    {#if error}<p class="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

    {#if searched}
      {#if people.length}
        <p class="mb-2 text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Tick everyone who is here today:', ar: 'حدّد كل من حضر اليوم:' }, $locale)}</p>
        <div class="card divide-y divide-slate-100 dark:divide-slate-800">
          {#each people as p}
            <label class="flex items-center gap-3 p-4 text-base">
              <input type="checkbox" class="h-5 w-5" checked={checked.has(p.id)} onchange={() => toggle(p.id)} />
              {p.name}
            </label>
          {/each}
        </div>
      {:else}
        <p class="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{tr({ en: "No match — add your name below and you'll be added to the church directory.", ar: 'لا يوجد تطابق — أضف اسمك بالأسفل وسيُضاف إلى سجل الكنيسة.' }, $locale)}</p>
      {/if}
    {/if}

    <!-- Add new people (spouse/kids/guests not in the list) -->
    <div class="mt-4">
      {#each newMembers as m, i}
        <div class="card mb-2 space-y-2 p-3">
          <div class="flex gap-2">
            <input class="input" bind:value={m.givenName} placeholder={tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} />
            <input class="input" bind:value={m.familyName} placeholder={tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} />
            <button type="button" class="btn-ghost shrink-0 text-rose-600" onclick={() => removeNew(i)}>✕</button>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" bind:checked={m.isChild} /> {tr({ en: 'Child', ar: 'طفل' }, $locale)}
          </label>
        </div>
      {/each}
      <button type="button" class="btn-ghost w-full border border-dashed border-slate-300 dark:border-slate-700" onclick={addNew}>
        + {tr({ en: 'Add someone with me (spouse, child, guest)', ar: 'إضافة شخص معي (زوج/ة، طفل، ضيف)' }, $locale)}
      </button>
    </div>

    <button class="btn-primary mt-6 w-full py-3 text-base" onclick={submit} disabled={submitting}>
      {submitting ? $t('common.loading') : tr({ en: 'Check in', ar: 'تسجيل الحضور' }, $locale)}
    </button>
  {/if}
</div>
