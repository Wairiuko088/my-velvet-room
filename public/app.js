const productGrid = document.querySelector("#product-grid");
const checkoutDialog = document.querySelector("#checkout-dialog");
const checkoutForm = document.querySelector("#checkout-form");
const checkoutButton = document.querySelector("#checkout-submit");
const paymentStatus = document.querySelector("#payment-status");
const phoneInput = document.querySelector("#phone");
let selectedProduct = null;
let selectedKenyanPlan = null;
let pollTimer = null;
let allProducts = [];
let activeFilter = "all";
let allKenyanPlans = [];

const formatPrice = (amount) => `KES ${Number(amount).toLocaleString("en-KE")}`;

function renderProducts(products) {
  allProducts = products;
  document.querySelector("#release-count").textContent = String(products.length);
  const visibleProducts = activeFilter === "all"
    ? products
    : activeFilter === "subscription"
      ? []
      : products.filter((product) => product.type === activeFilter);
  const productCards = visibleProducts.map((product, index) => `
    <article class="product-card">
      <div class="product-art tone-${index + 1}" aria-label="Abstract artwork for ${escapeHtml(product.name)}">
        <span class="art-number">${escapeHtml(product.symbol)}</span>
        <span class="art-type">${escapeHtml(product.type)} · 18+</span>
        <span class="offer-badge">${escapeHtml(product.offer || "Exclusive offer")}</span>
      </div>
      <div class="product-info">
        <div class="product-meta"><span>${escapeHtml(product.type)}</span><span>Exclusive price</span></div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description)}</p>
        <div class="product-price"><strong>${formatPrice(product.price)}</strong></div>
        <button class="buy-button" data-product-id="${escapeHtml(product.id)}">Make it yours <span>↗</span></button>
      </div>
    </article>
  `);
  const planCards = activeFilter === "all" || activeFilter === "subscription"
    ? allKenyanPlans.map((plan) => `
      <article class="product-card subscription-product-card">
        <div class="product-art tone-3" aria-label="50 percent off 30-day access">
          <span class="art-number">50%</span>
          <span class="art-type">30 DAYS · 18+</span>
          <span class="offer-badge">${escapeHtml(plan.offer)}</span>
        </div>
        <div class="product-info">
          <div class="product-meta"><span>M-Pesa subscription</span><span>One-time</span></div>
          <h3>${escapeHtml(plan.name)}</h3>
          <p>Full access for 30 days. Renew manually whenever you like.</p>
          <div class="product-price"><strong>${formatPrice(plan.amount)}</strong><del>${formatPrice(plan.regularAmount)}</del></div>
          <button class="buy-button" data-mpesa-plan-id="${escapeHtml(plan.id)}">Get 30 days <span>↗</span></button>
        </div>
      </article>
    `)
    : [];
  productGrid.innerHTML = [...productCards, ...planCards].join("") || '<p class="loading-card">No options in this category.</p>';
}

document.querySelector(".feed-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".feed-filter").forEach((filterButton) => {
    const isActive = filterButton === button;
    filterButton.classList.toggle("is-active", isActive);
    filterButton.setAttribute("aria-pressed", String(isActive));
  });
  renderProducts(allProducts);
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

async function loadProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Could not load the shop.");
    const data = await response.json();
    renderProducts(data.products);
  } catch (error) {
    productGrid.innerHTML = `<p class="loading-card">${escapeHtml(error.message)} Please refresh to try again.</p>`;
  }
}

productGrid.addEventListener("click", async (event) => {
  const planButton = event.target.closest("[data-mpesa-plan-id]");
  if (planButton) {
    selectedKenyanPlan = allKenyanPlans.find((plan) => plan.id === planButton.dataset.mpesaPlanId);
    if (!selectedKenyanPlan) {
      showToast("This M-Pesa plan is no longer available.");
      return;
    }
    openCheckout(selectedKenyanPlan, true);
    return;
  }

  const button = event.target.closest("[data-product-id]");
  if (!button) return;
  try {
    const response = await fetch("/api/products");
    const { products } = await response.json();
    selectedProduct = products.find((product) => product.id === button.dataset.productId);
    if (!selectedProduct) throw new Error("This item is no longer available.");
    selectedKenyanPlan = null;
    openCheckout(selectedProduct);
  } catch (error) {
    showToast(error.message);
  }
});

function openCheckout(item, isKenyanPlan = false) {
  selectedProduct = isKenyanPlan ? null : item;
  selectedKenyanPlan = isKenyanPlan ? item : null;
  document.querySelector("#checkout-item").textContent = `${item.name} · ${formatPrice(isKenyanPlan ? item.amount : item.price)}`;
  paymentStatus.textContent = "";
  paymentStatus.className = "payment-status";
  checkoutForm.hidden = false;
  checkoutButton.disabled = false;
  checkoutButton.innerHTML = 'Pay with M-Pesa <span aria-hidden="true">→</span>';
  phoneInput.value = "";
  checkoutDialog.showModal();
}

async function loadKenyanPlans() {
  try {
    const response = await fetch("/api/mpesa-plans");
    if (!response.ok) throw new Error("Could not load M-Pesa plans.");
    const data = await response.json();
    allKenyanPlans = data.plans;
    renderProducts(allProducts);
  } catch (error) {
    showToast(`${error.message} Please refresh to try again.`);
  }
}

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProduct && !selectedKenyanPlan) return;
  checkoutButton.disabled = true;
  checkoutButton.textContent = "Connecting to M-Pesa…";
  paymentStatus.textContent = "";
  paymentStatus.className = "payment-status";

  try {
    const response = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(selectedKenyanPlan ? { planId: selectedKenyanPlan.id } : { productId: selectedProduct.id }),
        phone: phoneInput.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start payment.");
    checkoutForm.hidden = true;
    paymentStatus.textContent = data.customerMessage || "Check your phone and enter your M-Pesa PIN to complete payment.";
    pollPayment(data.checkoutRequestId);
  } catch (error) {
    paymentStatus.textContent = error.message;
    paymentStatus.className = "payment-status error";
    checkoutButton.disabled = false;
    checkoutButton.innerHTML = 'Pay with M-Pesa <span aria-hidden="true">→</span>';
  }
});

async function pollPayment(checkoutRequestId) {
  const deadline = Date.now() + 180_000;
  clearTimeout(pollTimer);
  while (Date.now() < deadline) {
    await new Promise((resolve) => { pollTimer = setTimeout(resolve, 2500); });
    try {
      const response = await fetch(`/api/payments/${encodeURIComponent(checkoutRequestId)}`);
      const data = await response.json();
      if (data.status === "paid") {
        paymentStatus.textContent = "Payment confirmed. Thank you — your purchase is complete.";
        paymentStatus.className = "payment-status success";
        return;
      }
      if (data.status === "failed" || data.status === "expired") {
        paymentStatus.textContent = data.status === "failed"
          ? "Payment was not completed. You can close this window and try again."
          : "This payment request has expired. Close this window and try again.";
        paymentStatus.className = "payment-status error";
        return;
      }
    } catch {
      // Keep checking until the request reaches a final state or times out.
    }
  }
  paymentStatus.textContent = "Still waiting for confirmation. Check your M-Pesa messages before trying again.";
  paymentStatus.className = "payment-status";
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 3500);
}

const ageScreen = document.querySelector("#age-screen");
if (sessionStorage.getItem("velvet-age-confirmed") === "yes") ageScreen.hidden = true;
document.querySelector("#age-confirm").addEventListener("click", () => {
  sessionStorage.setItem("velvet-age-confirmed", "yes");
  ageScreen.hidden = true;
});

checkoutDialog.addEventListener("close", () => {
  clearTimeout(pollTimer);
});

loadProducts();
loadKenyanPlans();
