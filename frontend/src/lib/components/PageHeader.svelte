<script lang="ts">
  import type { Snippet } from 'svelte';
  import BackButton from './BackButton.svelte';
  // back: pass a href string for a "back to list" link (omit for no back button).
  let { title, actions, back }: { title: string; actions?: Snippet; back?: string } = $props();
</script>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <div class="flex min-w-0 items-center gap-2">
    {#if back}<BackButton href={back} />{/if}
    <h1 class="text-xl font-semibold sm:text-2xl">{title}</h1>
  </div>
  {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</div>
