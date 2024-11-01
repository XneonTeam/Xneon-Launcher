import json
import minecraft_launcher_lib
import subprocess
import customtkinter as CTk
from minecraft_launcher_lib.utils import get_version_list
from minecraft_launcher_lib.command import get_minecraft_command
from minecraft_launcher_lib.fabric import get_latest_loader_version as get_latest_fabric_version, install_fabric
from minecraft_launcher_lib.quilt import get_latest_loader_version as get_latest_quilt_version, install_quilt
import minecraft_launcher_lib.forge as forge
from minecraft_launcher_lib.install import install_minecraft_version
import requests
import re
import socket
import psutil
import os
import threading
import pystray
from PIL import Image
from uuid import uuid1
from subprocess import CREATE_NO_WINDOW
from pypresence import Presence
import time

app = CTk.CTk()
app.geometry("920x460")
app.resizable(False, False)
app.title("Xneon Launcher 1.8")
icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Xneon Launcher.ico")
app.iconbitmap(icon_path)
minecraft_directory = minecraft_launcher_lib.utils.get_minecraft_directory().replace('minecraft', 'xneonlauncher')
news_url = "https://raw.githubusercontent.com/XneonTeam/Xneon-Launcher/refs/heads/main/launcher"

is_connected = False
versions_combobox_startvar = CTk.StringVar()
current_news_link = ""
max_ram = round(psutil.virtual_memory().total / (1024 ** 2))
selected_ram = 1024
selected_loader = "Vanilla"

settings_file = "settings.json"
accounts_file = "accounts.json"

hide_old_beta = CTk.BooleanVar(value=False)
hide_release = CTk.BooleanVar(value=False)
hide_snapshot = CTk.BooleanVar(value=False)
hide_old_alpha = CTk.BooleanVar(value=False)

CLIENT_ID = '1279183673660538972'
discord_rpc = None

progress_bar = CTk.CTkProgressBar(app, width=380)

def setup_discord_rpc():
    global discord_rpc
    try:
        discord_rpc = Presence(CLIENT_ID)
        discord_rpc.connect()
        update_discord_rpc("Запущен Xneon Launcher", "Ожидание запуска...")
    except Exception as e:
        print(f"Ошибка подключения к Discord RPC: {e}")

def update_discord_rpc(state_text, details_text):
    if discord_rpc:
        try:
            small_image_key = {
                "Forge": "forge_icon",
                "Fabric": "fabric_icon",
                "Quilt": "quilt_icon"
            }.get(selected_loader, None)

            discord_rpc.update(
                state=state_text,
                details=details_text,
                large_image="https://i.imgur.com/1u1oHSS.png",
                small_image=small_image_key,
                buttons=[{"label": "Посетите наш сайт", "url": "https://activator.xneon.fun"}]
            )
        except Exception as e:
            print(f"Ошибка обновления Discord RPC: {e}")

def load_settings():
    global selected_ram, selected_loader
    if os.path.exists(settings_file):
        with open(settings_file, "r") as file:
            settings = json.load(file)
            selected_ram = settings.get("ram", max_ram // 2)
            selected_loader = settings.get("loader", "Vanilla")
            versions_combobox_startvar.set(settings.get("last_version", ""))
            ram_scale.set(selected_ram)
            ram_value_label.configure(text=f"Выбрано RAM: {selected_ram} MB")
            hide_old_beta.set(settings.get("hide_old_beta", False))
            hide_release.set(settings.get("hide_release", False))
            hide_snapshot.set(settings.get("hide_snapshot", False))
            hide_old_alpha.set(settings.get("hide_old_alpha", False))
            hide_console_var.set(settings.get("hide_console", True))
            loader_combobox.set(selected_loader)

    else:
        selected_ram = max_ram // 2
        selected_loader = "Vanilla"
        ram_scale.set(selected_ram)
        ram_value_label.configure(text=f"Выбрано RAM: {selected_ram} MB")
        loader_combobox.set(selected_loader)
        hide_console_var.set(True)

def save_settings():
    with open(settings_file, "w") as file:
        json.dump({
            "ram": selected_ram,
            "loader": selected_loader,
            "last_version": versions_combobox_startvar.get(),
            "hide_old_beta": hide_old_beta.get(),
            "hide_release": hide_release.get(),
            "hide_snapshot": hide_snapshot.get(),
            "hide_old_alpha": hide_old_alpha.get(),
            "hide_console": hide_console_var.get()
        }, file)

def get_text_from_url(url):
    response = requests.get(url)
    return response.text

def update_news(text):
    global current_news_link
    match = re.search(r'https?://[^\s]+', text)
    current_news_link = match.group(0) if match else ""
    text_without_link = re.sub(r'https?://[^\s]+', '', text).strip()
    newsTextbox.configure(state="normal")
    newsTextbox.delete("1.0", "end")
    newsTextbox.insert("1.0", text_without_link)
    newsTextbox.configure(state="disabled")

def load_versions():
    global is_connected, versions_combobox_startvar
    if not is_connected:
        return
    try:
        all_versions = get_version_list()
        filtered_versions = []

        for version in all_versions:
            version_id = version['id']

            if selected_loader == "Fabric" and not version_id.startswith(("1.14.", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21.")):
                continue
            if selected_loader == "Quilt" and not version_id.startswith(("1.14.4", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21.")):
                continue
            if selected_loader == "Forge" and (version.get('type') != 'release' or not version_id.startswith(("1.12.2", "1.13.", "1.14.", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21.1"))):
                continue

            if (
                    (hide_old_beta.get() and version.get('type') == 'old_beta') or
                    (hide_release.get() and version.get('type') == 'release') or
                    (hide_snapshot.get() and version.get('type') == 'snapshot') or
                    (hide_old_alpha.get() and version.get('type') == 'old_alpha')
            ):
                continue

            filtered_versions.append(version_id)

        version_combobox.configure(values=filtered_versions)
        if filtered_versions:
            version_combobox.set(filtered_versions[0])
            versions_combobox_startvar.set(filtered_versions[0])
        else:
            version_combobox.set("")
    except Exception as e:
        print(f"Ошибка загрузки версий: {e}")

def load_all_data():
    load_versions()
    text = get_text_from_url(news_url)
    update_news(text)

def check_internet_connection():
    global is_connected
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=5)
        is_connected = True
        warning_label.configure(text="")
        load_all_data()
    except OSError:
        is_connected = False
        show_warning()

def show_warning():
    warning_label.configure(text="Пожалуйста, включите Интернет.", text_color="red")

def update_ram_label(value):
    global selected_ram
    selected_ram = int(value)
    ram_value_label.configure(text=f"Выбрано RAM: {selected_ram} MB")
    save_settings()

def load_accounts():
    if os.path.exists(accounts_file):
        with open(accounts_file, "r") as file:
            content = file.read()
            if content.strip():
                return json.loads(content)
    return []

def save_accounts(accounts):
    with open(accounts_file, "w") as file:
        json.dump(accounts, file)

class ForgeInstallThread(threading.Thread):
    def __init__(self, version_id, minecraft_directory, completion_callback):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory
        self.completion_callback = completion_callback

    def run(self):
        try:
            forge_version_id = forge.find_forge_version(self.version_id)
            if not forge_version_id:
                self.completion_callback(False, "")
                return

            correct_forge_version_id = f"{self.version_id}-forge-{forge_version_id.split('-')[-1]}"
            version_path = os.path.join(self.minecraft_directory, "versions", correct_forge_version_id)

            if os.path.exists(version_path):
                self.completion_callback(True, correct_forge_version_id)
                return

            progress_bar.start()
            progress_bar.place(x=5, y=430)
            forge.install_forge_version(
                forge_version_id,
                self.minecraft_directory,
                callback={
                    'setStatus': lambda v: None,
                    'setProgress': self.update_progress,
                    'setMax': lambda v: None
                }
            )
            self.completion_callback(True, correct_forge_version_id)
        except Exception as e:
            print(f"Ошибка установки Forge: {e}")
            self.completion_callback(False, "")
        finally:
            progress_bar.stop()

    def update_progress(self, progress):
        progress_bar.set(progress)

class FabricInstallThread(threading.Thread):
    def __init__(self, version_id, minecraft_directory, completion_callback):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory
        self.completion_callback = completion_callback

    def run(self):
        try:
            fabric_loader_version = get_latest_fabric_version()
            fabric_version_id = f"fabric-loader-{fabric_loader_version}-{self.version_id}"
            version_path = os.path.join(self.minecraft_directory, "versions", fabric_version_id)
            if os.path.exists(version_path):
                self.completion_callback(True, fabric_version_id)
                return

            progress_bar.start()
            progress_bar.place(x=5, y=430)
            install_fabric(self.version_id, self.minecraft_directory)
            self.completion_callback(True, fabric_version_id)
        except Exception as e:
            print(f"Ошибка установки Fabric: {e}")
            self.completion_callback(False, "")
        finally:
            progress_bar.stop()

class QuiltInstallThread(threading.Thread):
    def __init__(self, version_id, minecraft_directory, completion_callback):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory
        self.completion_callback = completion_callback

    def run(self):
        try:
            quilt_loader_version = get_latest_quilt_version()
            quilt_version_id = f"quilt-loader-{quilt_loader_version}-{self.version_id}"
            version_path = os.path.join(self.minecraft_directory, "versions", quilt_version_id)
            if os.path.exists(version_path):
                self.completion_callback(True, quilt_version_id)
                return

            progress_bar.start()
            progress_bar.place(x=5, y=430)
            install_quilt(self.version_id, self.minecraft_directory)
            self.completion_callback(True, quilt_version_id)
        except Exception as e:
            print(f"Ошибка установки Quilt: {e}")
            self.completion_callback(False, "")
        finally:
            progress_bar.stop()

def get_mod_count():
    mods_directory = os.path.join(minecraft_directory, "mods")
    try:
        mod_files = os.listdir(mods_directory)
        return len([f for f in mod_files if f.endswith('.jar') or f.endswith('.zip')])
    except Exception as e:
        print(f"Ошибка при подсчете модов: {e}")
        return 0

def launch_game():
    def run_install_and_launch():
        version_id = versions_combobox_startvar.get()
        username = NickName.get()
        show_console = not hide_console_var.get()
        memory = selected_ram / 1024

        disable_controls()

        def on_completion(success, loader_version_id):
            progress_bar.stop()
            if success:
                start_game(loader_version_id, username, show_console, memory)
            else:
                print(f"Установка {selected_loader} завершилась неудачно.")
                enable_controls()

        progress_bar.place(x=5, y=430)
        if selected_loader in ["Fabric", "Quilt", "Forge"]:
            progress_bar.start()

            if selected_loader == "Fabric":
                install_thread = FabricInstallThread(version_id, minecraft_directory, on_completion)
                install_thread.start()
            elif selected_loader == "Quilt":
                install_thread = QuiltInstallThread(version_id, minecraft_directory, on_completion)
                install_thread.start()
            elif selected_loader == "Forge":
                install_thread = ForgeInstallThread(version_id, minecraft_directory, on_completion)
                install_thread.start()
        elif selected_loader == "Vanilla":
            progress_bar.start()
            install_version(version_id, username, show_console, memory)
        else:
            print("Выбранный модлоадер не поддерживается.")

    threading.Thread(target=run_install_and_launch, daemon=True).start()

def is_version_installed(version_id):
    versions_path = os.path.join(minecraft_directory, "versions", version_id)
    return os.path.exists(versions_path)

def install_version(version_id, username, show_console, memory):
    try:
        progress_bar.start()
        progress_bar.place(x=5, y=430)
        install_minecraft_version(version_id, minecraft_directory)
        start_game(version_id, username, show_console, memory)
    except Exception as e:
        print(f"Ошибка установки версии: {e}")
        progress_bar.stop()

def start_game(version_id, username, show_console, memory):
    memory = int(memory)
    options = {
        'username': username,
        'uuid': str(uuid1()),
        'token': '',
        'jvmArguments': [f"-Xmx{memory}G", f"-Xms{memory}G"]
    }
    creationflags = 0 if show_console else CREATE_NO_WINDOW

    version_rpc = version_id.split('-')[-1]
    forge_rpc = version_id.split('-')[0]

    if selected_loader == "Vanilla":
        state_text = f"Играет на версии {version_rpc}"
    elif selected_loader in ["Fabric", "Quilt"]:
        state_text = f"Играет на версии {version_rpc}"
    else:
        state_text = f"Играет на версии {forge_rpc}"

    details_text = "Запущен Xneon Launcher"

    update_discord_rpc(state_text, details_text)

    process = subprocess.Popen(
        get_minecraft_command(version=version_id, minecraft_directory=minecraft_directory, options=options),
        creationflags=creationflags
    )

    disable_controls()

    process.wait()

    progress_bar.place_forget()
    enable_controls()
    update_discord_rpc("Запущен Xneon Launcher", "Ожидание запуска...")

def open_account_manager():
    account_manager_window = CTk.CTkToplevel(app)
    account_manager_window.title("Менеджер аккаунтов")
    account_manager_window.attributes("-topmost", True)
    account_manager_window.geometry("300x100")

    account_manager_window.resizable(False, False)
    AccountManager(account_manager_window)

class AccountManager:
    def __init__(self, master):
        self.master = master
        self.accounts = load_accounts()

        self.account_combobox = CTk.CTkComboBox(master, values=self.accounts, command=self.update_nickname)
        self.account_combobox.pack(pady=20)

        self.btn_add = CTk.CTkButton(master, text="Добавить аккаунт", command=self.open_add_account_dialog)
        self.btn_add.pack(side=CTk.LEFT, padx=10)

        self.btn_remove = CTk.CTkButton(master, text="Удалить аккаунт", command=self.open_remove_account_dialog)
        self.btn_remove.pack(side=CTk.LEFT, padx=10)

    def update_nickname(self, selected_account):
        NickName.delete(0, CTk.END)
        NickName.insert(0, selected_account)

    def open_add_account_dialog(self):
        dialog = CTk.CTkToplevel(self.master)
        dialog.title("Добавить аккаунт")
        dialog.resizable(False, False)
        dialog.attributes("-topmost", True)
        dialog.geometry("300x150")

        CTk.CTkLabel(dialog, text="Введите имя аккаунта:").pack(pady=10)
        entry = CTk.CTkEntry(dialog, placeholder_text="Имя аккаунта")
        entry.pack(pady=10)

        def add_account():
            account_name = entry.get()
            if account_name and account_name not in self.accounts:
                self.accounts.append(account_name)
                save_accounts(self.accounts)
                self.account_combobox.configure(values=self.accounts)
                dialog.destroy()

        CTk.CTkButton(dialog, text="Добавить", command=add_account).pack(pady=10)

    def open_remove_account_dialog(self):
        if not self.accounts:
            return

        dialog = CTk.CTkToplevel(self.master)
        dialog.title("Удалить аккаунт")
        dialog.resizable(False, False)

        CTk.CTkLabel(dialog, text="Выберите аккаунт для удаления:").pack(pady=10)

        account_combobox = CTk.CTkComboBox(dialog, values=self.accounts)
        account_combobox.pack(pady=10)

        account_combobox.set(self.accounts[0])
        NickName.delete(0, CTk.END)
        NickName.insert(0, self.accounts[0])

        def remove_account():
            account_to_remove = account_combobox.get()
            if account_to_remove in self.accounts:
                self.accounts.remove(account_to_remove)
                save_accounts(self.accounts)
                account_combobox.configure(values=self.accounts)

                if self.accounts:
                    account_combobox.set(self.accounts[0])
                    NickName.delete(0, CTk.END)
                    NickName.insert(0, self.accounts[0])
                else:
                    NickName.delete(0, CTk.END)

                dialog.destroy()

        CTk.CTkButton(dialog, text="Удалить", command=remove_account).pack(pady=10)

settings_frame = CTk.CTkFrame(master=app, width=450, height=450, corner_radius=10)
settings_frame.place(x=460, y=5)
CTk.CTkLabel(settings_frame, text="Настройки", font=("Arial", 16)).place(x=10, y=10)

ram_label = CTk.CTkLabel(settings_frame, text=f"Максимально доступно ОЗУ: {max_ram} MB")
ram_label.place(x=10, y=50)
ram_scale = CTk.CTkSlider(master=settings_frame, from_=512, to=max_ram, number_of_steps=(max_ram - 512) // 512, command=update_ram_label)
ram_scale.place(x=250, y=50)
ram_scale.set(selected_ram)

ram_value_label = CTk.CTkLabel(settings_frame, text=f"Выбрано RAM: {selected_ram} MB")
ram_value_label.place(x=10, y=80)

CTk.CTkLabel(settings_frame, text="Выберите модлоадер:").place(x=10, y=120)

loader_combobox = CTk.CTkComboBox(settings_frame, values=["Vanilla", "Forge", "Quilt", "Fabric"], command=lambda value: update_loader(value), state='readonly')
loader_combobox.place(x=10, y=150)
loader_combobox.set(selected_loader)

loader_combobox.bind("<ButtonPress>", lambda event: "break")
loader_combobox.bind("<KeyPress>", lambda event: "break")

def update_loader(value):
    global selected_loader
    selected_loader = value
    load_versions()
    save_settings()

CTk.CTkLabel(settings_frame, text="Скрыть версии:").place(x=10, y=200)

hide_old_beta_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Beta", variable=hide_old_beta, command=load_versions)
hide_old_beta_checkbox.place(x=10, y=230)
hide_release_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Release", variable=hide_release, command=load_versions)
hide_release_checkbox.place(x=10, y=260)
hide_snapshot_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Snapshot", variable=hide_snapshot, command=load_versions)
hide_snapshot_checkbox.place(x=10, y=290)
hide_old_alpha_checkbox = CTk.CTkCheckBox(settings_frame, text="Убрать Alpha", variable=hide_old_alpha, command=load_versions)
hide_old_alpha_checkbox.place(x=10, y=320)

hide_console_var = CTk.BooleanVar(value=True)
hide_console_checkbox = CTk.CTkCheckBox(settings_frame, text="Скрыть консоль", variable=hide_console_var)
hide_console_checkbox.place(x=10, y=350)

save_button = CTk.CTkButton(settings_frame, text="Сохранить", command=save_settings)
save_button.place(x=10, y=390)

frame_news = CTk.CTkFrame(master=app, width=400, height=420, corner_radius=10)
frame_news.place(x=5, y=5)

newsTextbox = CTk.CTkTextbox(master=frame_news, wrap="word", width=380, height=360, state="normal")
newsTextbox.pack(pady=10)

def disable_selection(event):
    return "break"

newsTextbox.bind("<ButtonPress>", disable_selection)
newsTextbox.bind("<KeyPress>", disable_selection)
newsTextbox.configure(state="disabled")

warning_label = CTk.CTkLabel(app, text="", text_color="red")
warning_label.place(x=5, y=435)

version_combobox = CTk.CTkComboBox(master=app, values=[], variable=versions_combobox_startvar)
version_combobox.place(x=540, y=425)

NickName = CTk.CTkEntry(master=app, placeholder_text="Username")
NickName.place(x=690, y=425)

play_button = CTk.CTkButton(master=app, text="Играть", command=launch_game, width=70)
play_button.place(x=835, y=425)

account_manager_button = CTk.CTkButton(
    master=settings_frame, text="👤", command=open_account_manager, width=30, height=30
)
account_manager_button.place(x=420, y=10)

icon = pystray.Icon("Xneon Launcher")
icon.icon = Image.open(icon_path)
icon.title = "Xneon Launcher"
icon.menu = pystray.Menu(
    pystray.MenuItem("Показать", lambda: app.deiconify()),
    pystray.MenuItem("Выход", lambda: (icon.stop(), app.quit()))
)

def run_tray():
    icon.run()

tray_thread = threading.Thread(target=run_tray, daemon=True)
tray_thread.start()

def close_app():
    app.withdraw()

app.protocol("WM_DELETE_WINDOW", close_app)

def disable_controls():
    version_combobox.configure(state="disabled")
    loader_combobox.configure(state="disabled")
    play_button.configure(state="disabled")

def enable_controls():
    version_combobox.configure(state="normal")
    loader_combobox.configure(state="normal")
    play_button.configure(state="normal")

def run_application():
    load_settings()  
    accounts = load_accounts()
    if accounts:
        NickName.insert(0, accounts[0])
    check_internet_connection()
    setup_discord_rpc()
    app.mainloop()

if __name__ == "__main__":
    run_application()
