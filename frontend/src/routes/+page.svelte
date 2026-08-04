<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { isAuthed } from '$lib/stores/auth.js';

  onMount(() => {
    goto(isAuthed() ? '/dashboard' : '/login', { replaceState: true });
  });
</script>
