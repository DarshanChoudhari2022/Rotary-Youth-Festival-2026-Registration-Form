try {
  const result = JSON.parse(sessionStorage.getItem('festival-registration'));
  if (result?.status === 'pending'
      && /^RYF26-[0-9A-F]{8}$/.test(result.registration_id)
      && Number.isSafeInteger(result.amount_paise) && result.amount_paise > 0) {
    const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
    document.querySelector('#receipt-heading').textContent = 'Registration saved';
    document.querySelector('#receipt-id').textContent = result.registration_id;
    document.querySelector('#receipt-total').textContent = amount.format(result.amount_paise / 100);
    document.querySelector('#registration-receipt').hidden = false;
    document.querySelector('#receipt-empty').hidden = true;
  }
} catch {
  // Direct visits and disabled browser storage use the default page content.
}
