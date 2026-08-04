<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, actions }: { title: string; actions?: Snippet } = $props();
</script>

<div class="mb-6 flex items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold">{title}</h1>
  {#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
</div>
