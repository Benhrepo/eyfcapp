const keyInput = document.getElementById("syncKey");
const status = document.getElementById("status");

chrome.storage.local.get("syncKey").then(saved => {
  if (saved.syncKey) keyInput.value = saved.syncKey;
});

document.getElementById("save").addEventListener("click", async () => {
  const syncKey = keyInput.value.trim();
  if (syncKey.length < 32) {
    status.textContent = "The private key must contain at least 32 characters.";
    return;
  }
  await chrome.storage.local.set({ syncKey });
  status.textContent = "Saved. You will not need to enter it again in this Chrome profile.";
});
