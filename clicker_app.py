import threading
import time
import tkinter as tk
from tkinter import ttk

from pynput import keyboard, mouse
from pynput.keyboard import Key, Controller as KeyboardController
from pynput.mouse import Button, Controller as MouseController

kb_controller = KeyboardController()
mouse_controller = MouseController()

running = False
click_thread = None


def click_loop(get_interval_ms, get_mode, get_key):
    while running:
        mode = get_mode()
        if mode == "mouse":
            mouse_controller.click(Button.left)
        else:
            key_str = get_key().strip()
            if key_str:
                try:
                    key = key_str.lower()
                    kb_controller.press(key)
                    kb_controller.release(key)
                except Exception:
                    pass
        interval = get_interval_ms() / 1000.0
        time.sleep(max(interval, 0.001))


class App:
    def __init__(self, root):
        self.root = root
        root.title("Автокликер")
        root.resizable(False, False)

        pad = {"padx": 10, "pady": 6}

        frame = ttk.Frame(root)
        frame.pack(fill="both", expand=True, **pad)

        ttk.Label(frame, text="Как часто нажимать:", font=("Segoe UI", 9, "bold")).grid(
            row=0, column=0, columnspan=2, sticky="w")

        self.speed_mode_var = tk.StringVar(value="fast")
        ttk.Radiobutton(frame, text="Быстро — раз в секунду:", variable=self.speed_mode_var,
                        value="fast", command=self.update_speed_state).grid(row=1, column=0, sticky="w")
        self.fast_var = tk.StringVar(value="10")
        self.fast_entry = ttk.Entry(frame, textvariable=self.fast_var, width=6)
        self.fast_entry.grid(row=1, column=1, sticky="w")

        ttk.Radiobutton(frame, text="Редко — раз в", variable=self.speed_mode_var,
                        value="slow", command=self.update_speed_state).grid(row=2, column=0, sticky="w")
        slow_frame = ttk.Frame(frame)
        slow_frame.grid(row=2, column=1, sticky="w")
        self.slow_var = tk.StringVar(value="10")
        self.slow_entry = ttk.Entry(slow_frame, textvariable=self.slow_var, width=6)
        self.slow_entry.pack(side="left")
        ttk.Label(slow_frame, text="сек").pack(side="left", padx=(4, 0))

        ttk.Separator(frame).grid(row=3, column=0, columnspan=2, sticky="ew", pady=8)

        self.mode_var = tk.StringVar(value="mouse")
        ttk.Radiobutton(frame, text="Мышь (левая кнопка)", variable=self.mode_var, value="mouse",
                        command=self.update_key_state).grid(row=4, column=0, columnspan=2, sticky="w")
        ttk.Radiobutton(frame, text="Клавиатура:", variable=self.mode_var, value="keyboard",
                        command=self.update_key_state).grid(row=5, column=0, sticky="w")

        self.key_var = tk.StringVar(value="e")
        self.key_entry = ttk.Entry(frame, textvariable=self.key_var, width=5)
        self.key_entry.grid(row=5, column=1, sticky="w")

        self.status_var = tk.StringVar(value="Остановлен")
        status_label = ttk.Label(frame, textvariable=self.status_var, font=("Segoe UI", 11, "bold"))
        status_label.grid(row=6, column=0, columnspan=2, pady=(14, 4))

        ttk.Label(frame, text="F8 — запустить / остановить").grid(row=7, column=0, columnspan=2)

        self.update_speed_state()

        self.update_key_state()

        self.hotkey_listener = keyboard.Listener(on_press=self.on_press)
        self.hotkey_listener.start()

        root.protocol("WM_DELETE_WINDOW", self.on_close)

    def update_key_state(self):
        if self.mode_var.get() == "keyboard":
            self.key_entry.state(["!disabled"])
        else:
            self.key_entry.state(["disabled"])

    def update_speed_state(self):
        if self.speed_mode_var.get() == "fast":
            self.fast_entry.state(["!disabled"])
            self.slow_entry.state(["disabled"])
        else:
            self.fast_entry.state(["disabled"])
            self.slow_entry.state(["!disabled"])

    def get_interval_ms(self):
        try:
            if self.speed_mode_var.get() == "fast":
                per_second = max(float(self.fast_var.get()), 1)
                return 1000.0 / per_second
            else:
                seconds = max(float(self.slow_var.get()), 0.001)
                return seconds * 1000.0
        except ValueError:
            return 1000

    def get_mode(self):
        return self.mode_var.get()

    def get_key(self):
        return self.key_var.get()

    def on_press(self, key):
        if key == Key.f8:
            self.root.after(0, self.toggle)

    def toggle(self):
        global running, click_thread
        if running:
            running = False
            self.status_var.set("Остановлен")
        else:
            running = True
            self.status_var.set("Работает")
            click_thread = threading.Thread(
                target=click_loop,
                args=(self.get_interval_ms, self.get_mode, self.get_key),
                daemon=True,
            )
            click_thread.start()

    def on_close(self):
        global running
        running = False
        self.hotkey_listener.stop()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()
