document.querySelectorAll('.filters select').forEach((control) => control.addEventListener('change', () => control.form.requestSubmit()));
