<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { initAppearance } from '$lib/stores/appearance.js';
  let { children } = $props();
  onMount(initAppearance);
</script>

{@render children()}
