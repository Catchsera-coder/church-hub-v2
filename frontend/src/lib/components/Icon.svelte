<script lang="ts">
  import { ICONS } from '$lib/icons.js';
  let { name, class: cls = 'h-5 w-5' }: { name: string; class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={cls} aria-hidden="true">
  {@html ICONS[name] ?? ICONS.dot}
</svg>
