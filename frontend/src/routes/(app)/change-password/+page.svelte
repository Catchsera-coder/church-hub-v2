<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  // Password change now lives on the consolidated Security page.
  onMount(() => goto('/security', { replaceState: true }));
</script>
