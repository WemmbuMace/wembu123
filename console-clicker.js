// Вставьте в консоль браузера (F12) на нужной странице.
// Повторный запуск той же команды — остановка.

(function () {
  if (window.__clicker5s) {
    clearInterval(window.__clicker5s);
    window.__clicker5s = null;
    console.log('Кликер остановлен');
    return;
  }

  // Замените селектор на кнопку, которую нужно нажимать:
  const el = document.querySelector('button.your-class');

  // Или используйте элемент, выбранный в DevTools (вкладка Elements):
  // const el = $0;

  if (!el) {
    console.error('Элемент не найден. Укажите правильный селектор.');
    return;
  }

  el.click();
  window.__clicker5s = setInterval(() => el.click(), 5000);
  console.log('Кликер запущен: раз в 5 сек. Запустите скрипт снова — стоп.');
})();
