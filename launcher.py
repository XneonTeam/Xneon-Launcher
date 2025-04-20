import psutil
import sys
import json
import minecraft_launcher_lib
import subprocess
import customtkinter as CTk
from nickname_generator import generate
import minecraft_launcher_lib as mcl
from minecraft_launcher_lib.microsoft_account import (
    get_secure_login_data,
    parse_auth_code_url,
    complete_login
)
from minecraft_launcher_lib.utils import get_version_list
from minecraft_launcher_lib.command import get_minecraft_command
from minecraft_launcher_lib.fabric import get_latest_loader_version as get_latest_fabric_version, install_fabric
from minecraft_launcher_lib.quilt import get_latest_loader_version as get_latest_quilt_version, install_quilt
import minecraft_launcher_lib.forge as forge
from minecraft_launcher_lib.install import install_minecraft_version
import requests
import re
import socket
import os
import threading
import pystray
import time
from PIL import Image
from uuid import uuid1
from subprocess import CREATE_NO_WINDOW
from pypresence import Presence
import shutil
from tkinter import filedialog
import webbrowser
from io import BytesIO
from bs4 import BeautifulSoup
import re
from CTkScrollableDropdown import *
from CTkMessagebox import CTkMessagebox
import logging
from minecraft_launcher_lib.utils import get_latest_version
import zipfile
import http.server
import socketserver
import urllib.parse

def fetch_minecraft_updates():
    url = "https://launchercontent.mojang.com/javaPatchNotes.json"
    try:
        data = requests.get(url).json()
        entry = data["entries"][0]
        body = BeautifulSoup(entry.get('body', 'Нет содержания'), 'html.parser').get_text(separator="\n")
        body = re.sub(r'\n+', '\n\n', body).strip()

        title = entry.get('title', 'Нет заголовка')
        title = f"🌍{title}⚙️" if "Snapshot" in title else f"🌍{title}🎉" if "Release" in title else title

        body = re.sub(r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?)\s', '\n', body)
        body = '\n'.join([f"🛠️{s}" if re.search(r'\bfix(?:es)?\b', s, re.IGNORECASE) else s for s in body.split('\n')])
        body = re.sub(r'(Experimental Features)', r'🧪\1🧪', body)
        body = re.sub(r'(MC-\d+)', r'🐛\1', body)
        body = body.replace("Happy Mining!", "").replace("\n\n\n", "\n\n")

        return f"{title}\n\n{body}"
    except (requests.RequestException, KeyError, IndexError) as e:
        return f"Ошибка: {e}"

def center_window(window, width, height):
    screen_width = window.winfo_screenwidth()
    screen_height = window.winfo_screenheight()
    x = (screen_width / 2) - (width / 2)
    y = (screen_height / 2) - (height / 2)
    window.geometry(f'{width}x{height}+{int(x)}+{int(y)}')

def show_error_with_link(title, message):
    msg = CTkMessagebox(
        title=title,
        message=message,
        icon="cancel",
        option_1="Обратиться в поддержку",
        option_2="Закрыть предупреждение"
    )
    response = msg.get()
    if response == "Обратиться в поддержку":

        webbrowser.open("https://discord.gg/Qe2ytZpC4K")

PROCESS_NAME = "launcher.exe"
settings_file = "settings.json"

custom_resolution_width = None
custom_resolution_height = None

def count_processes(process_name):
    count = 0
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name'] == process_name:
                count += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return count

running_count = count_processes(PROCESS_NAME)
if running_count > 2:
    sys.exit()

AUTH_URL = 'https://auth.xneon.fun/discord/login'
AUTH_STATUS_URL = 'https://auth.xneon.fun/discord/auth-status'

app = CTk.CTk()
app.geometry("920x500")
app.resizable(False, False)
app.title("Xneon Launcher 2.0")
icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Xneon Launcher.ico")
app.iconbitmap(icon_path)

tabview = CTk.CTkTabview(app, width=400, height=420)
tabview.place(x=5, y=5)

tabview.add("Новости Лаунчера")
tabview.add("Обновления Minecraft")
newsTextbox = CTk.CTkTextbox(tabview.tab("Новости Лаунчера"), wrap="word", width=360, height=340)
newsTextbox.pack(pady=10, padx=10)


def update_minecraft_updates_tab():
    updates_text = fetch_minecraft_updates()
    updatesTextbox.configure(state="normal")
    updatesTextbox.delete("1.0", "end")
    updatesTextbox.insert("1.0", updates_text)
    updatesTextbox.configure(state="disabled")

updatesTextbox = CTk.CTkTextbox(tabview.tab("Обновления Minecraft"), wrap="word", width=360, height=340)
updatesTextbox.pack(pady=10, padx=10)

def disable_selection(event):
    return "break"

updatesTextbox.bind("<ButtonPress>", disable_selection)
updatesTextbox.bind("<KeyPress>", disable_selection)

update_minecraft_updates_tab()

center_window(app, 920, 500)

minecraft_directory = None

def check_and_copy_launcher_profiles(minecraft_directory):
    custom_directory = None
    if os.path.exists(settings_file):
        with open(settings_file, "r") as file:
            settings = json.load(file)
            custom_directory = settings.get("custom_minecraft_directory")
    
    if custom_directory:
        minecraft_directory = custom_directory
    
    launcher_profiles_path = os.path.join(minecraft_directory, "launcher_profiles.json")
    if not os.path.exists(launcher_profiles_path):
        script_directory = os.path.dirname(os.path.abspath(__file__))
        source_launcher_profiles_path = os.path.join(script_directory, "launcher_profiles.json")
        
        if os.path.exists(source_launcher_profiles_path):
            shutil.copy(source_launcher_profiles_path, launcher_profiles_path)

def initialize_minecraft_directory():
    global minecraft_directory
    minecraft_directory = minecraft_launcher_lib.utils.get_minecraft_directory()

    if not minecraft_directory:
        raise Exception("Директория Minecraft не найдена. Убедитесь, что Minecraft установлен.")

    if not os.path.exists(minecraft_directory):
        os.makedirs(minecraft_directory)

initialize_minecraft_directory()
check_and_copy_launcher_profiles(minecraft_directory)

clients_directory = os.path.join(minecraft_directory, "clients")
news_url = "https://raw.githubusercontent.com/XneonTeam/Xneon-Launcher/refs/heads/main/launcher"

is_connected = False
versions_combobox_startvar = CTk.StringVar()
current_news_link = ""
max_ram = round(psutil.virtual_memory().total / (1024 ** 2))
selected_ram = 1024
selected_loader = "Vanilla"

settings_file = "settings.json"
accounts_file = "accounts.json"
clients_file = "clients.json"

hide_old_beta = CTk.BooleanVar(value=False)
hide_release = CTk.BooleanVar(value=False)
hide_snapshot = CTk.BooleanVar(value=False)
hide_old_alpha = CTk.BooleanVar(value=False)
hide_directory_versions = CTk.BooleanVar(value=False)

CLIENT_ID = '1279183673660538972'
discord_rpc = None

def stop_minecraft():
    global minecraft_process
    if minecraft_process is not None and minecraft_process.poll() is None:
        try:
            minecraft_process.terminate()
            minecraft_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            minecraft_process.kill()
        except Exception as e:
            print(f"Ошибка при остановке Minecraft: {e}")
        finally:
            minecraft_process = None
            set_status("Minecraft остановлен")
            enable_controls()
    else:
        set_status("Нет активного процесса Minecraft")

minecraft_process = None
progress_bar = CTk.CTkProgressBar(app, width=380)
stop_button = CTk.CTkButton(master=app, text="⏹️", width=30, height=30, command=lambda: stop_minecraft())
status_label = CTk.CTkLabel(app, text="", text_color="black")
stop_button.place_forget()
status_label.place(x=5, y=460)

current_max = 0

def set_status(status: str):
    status_label.configure(text=status)

def set_progress(progress: int):
    if current_max != 0:
        progress_bar.set(progress / current_max)
        set_status(f"{progress}/{current_max}")

def set_max(new_max: int):
    global current_max
    current_max = new_max

def load_clients():
    if os.path.exists(clients_file):
        with open(clients_file, "r") as file:
            content = file.read()
            if content.strip():
                return json.loads(content)
    return []

def confirm_delete_client(self):
    selected_client = self.remove_client_combobox.get()
    if selected_client:
        delete_client(selected_client, self.clients_directory)
        self.update_versions()
        if self.version_combobox.get() == f"Custom - {selected_client}":
            self.version_combobox.set("")

def setup_discord_rpc():
    global discord_rpc
    try:
        discord_rpc = Presence(1279183673660538972)
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
                buttons=[
                    {"label": "Сайт Лаунчера", "url": "https://launcher.xneon.fun"},
                    {"label": "Дискорд Сервер", "url": "https://discord.com/invite/a9mDjtqcbQ"}
                ]
            )
        except Exception as e:
            print(f"Ошибка обновления Discord RPC: {e}")

def load_settings():
    global settings, selected_ram, selected_loader, versions_combobox_startvar, hide_directory_versions, custom_resolution_width, custom_resolution_height

    if os.path.exists(settings_file):
        with open(settings_file, "r") as file:
            settings = json.load(file)
            selected_ram = settings.get("ram", max_ram // 2)
            selected_loader = settings.get("loader", "Vanilla")
            last_version = settings.get("last_version", "")
            versions_combobox_startvar.set(last_version)
            last_account = settings.get("last_account", "")
            NickName.delete(0, CTk.END)
            NickName.insert(0, last_account)
            hide_old_beta.set(settings.get("hide_old_beta", False))
            hide_release.set(settings.get("hide_release", False))
            hide_snapshot.set(settings.get("hide_snapshot", False))
            hide_old_alpha.set(settings.get("hide_old_alpha", False))
            hide_console_var.set(settings.get("hide_console", True))
            hide_directory_versions.set(settings.get("hide_directory_versions", False))
            loader_combobox.set(selected_loader)
            custom_resolution_width = settings.get("custom_resolution_width", "")
            custom_resolution_height = settings.get("custom_resolution_height", "")
    else:
        settings = {}
        selected_ram = max_ram // 2
        selected_loader = "Vanilla"
        loader_combobox.set(selected_loader)
        hide_console_var.set(True)
        latest_version = get_latest_version()
        versions_combobox_startvar.set(latest_version["release"])

    accounts = load_accounts()
    if not accounts:
        random_nickname = generate_random_nickname()
        add_offline_account(random_nickname)
        
        NickName.delete(0, CTk.END)
        NickName.insert(0, f"{random_nickname} (оффлайн)")
        
            
def save_settings():
    global NickName, custom_minecraft_directory, custom_resolution_width, custom_resolution_height, custom_java_path
    username = NickName.get()
    
    if not any(suffix in username for suffix in [" (Ely.by)", " (оффлайн)", " (Microsoft)"]):
        username += " (оффлайн)"
        add_offline_account(username.replace(" (оффлайн)", ""))
    
    with open(settings_file, "w") as file:
        json.dump({
            "ram": selected_ram,
            "loader": selected_loader,
            "last_version": version_combobox.get(),
            "hide_old_beta": hide_old_beta.get(),
            "hide_release": hide_release.get(),
            "hide_snapshot": hide_snapshot.get(),
            "hide_old_alpha": hide_old_alpha.get(),
            "hide_console": hide_console_var.get(),
            "custom_minecraft_directory": custom_minecraft_directory.get(),
            "last_account": username,
            "hide_directory_versions": hide_directory_versions.get(),
            "custom_resolution_width": custom_resolution_width,
            "custom_resolution_height": custom_resolution_height,
            "custom_java_path": custom_java_path,
        }, file)
        
def update_last_account(selected_account):
    global NickName
    username = selected_account
    
    if "(Microsoft)" in username:
        NickName.delete(0, CTk.END)
        NickName.insert(0, username)
        save_settings()
        return
    
    if not any(suffix in username for suffix in [" (Ely.by)", " (оффлайн)"]):
        username += " (оффлайн)"
        add_offline_account(username.replace(" (оффлайн)", ""))
    
    NickName.delete(0, CTk.END)
    NickName.insert(0, username)
    save_settings()
    
def add_ely_account(account_name, uuid, access_token, client_token):
    accounts = load_accounts()
    for acc in accounts:
        if acc["username"] == account_name and acc["type"] == "ely":
            return

    ely_account = {
        "type": "ely",
        "username": account_name,
        "uuid": uuid,
        "access_token": access_token,
        "client_token": client_token
    }
    accounts.append(ely_account)
    save_accounts(accounts)

def add_offline_account(account_name):
    accounts = load_accounts()
    clean_account_name = account_name.replace(" (Ely.by)", "").replace(" (оффлайн)", "")

    for acc in accounts:
        if acc["username"] == clean_account_name and acc["type"] == "offline":
            return
        
    account_data = {
        "type": "offline",
        "username": clean_account_name
    }
    accounts.append(account_data)
    save_accounts(accounts)
    
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

def get_versions_from_directory():
    versions_path = os.path.join(minecraft_directory, "versions")
    version_list = []

    if os.path.exists(versions_path):
        for version_folder in os.listdir(versions_path):
            version_id = version_folder

            if not os.path.isdir(os.path.join(versions_path, version_folder)):
                continue

            if "forge" in version_id.lower() and "neoforge" not in version_id.lower():
                continue

            if any(keyword in version_id.lower() for keyword in ["fabric", "quilt"]):
                continue

            if re.match(r'^\d+(\.\d+)*(-pre\d+)?$', version_id):
                continue

            if "-rc" in version_id.lower() or "-pre" in version_id.lower():
                continue

            version_list.append(version_id)

    return version_list

def load_versions():
    global is_connected, version_combobox
    if not is_connected:
        return
    try:
        all_versions = minecraft_launcher_lib.utils.get_version_list()
        filtered_versions = []

        if selected_loader == "Clients":
            custom_versions = [f"Custom - {client['name']}" for client in load_clients("clients.json")]
            filtered_versions.extend(custom_versions)
        else:
            for version in all_versions:
                version_id = version['id']

                if selected_loader == "Fabric" and not version_id.startswith(("1.14.", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21.")):
                    continue
                if selected_loader == "Quilt" and not version_id.startswith(("1.14.4", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21.")):
                    continue
                if selected_loader == "Forge" and (version.get('type') != 'release' or not version_id.startswith(("1.12.2", "1.13.", "1.14.", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21."))):
                    continue

                if (
                    (hide_old_beta.get() and version.get('type') == 'old_beta') or
                    (hide_release.get() and version.get('type') == 'release') or
                    (hide_snapshot.get() and version.get('type') == 'snapshot') or
                    (hide_old_alpha.get() and version.get('type') == 'old_alpha')
                ):
                    continue

                filtered_versions.append(version_id)

        if selected_loader != "Clients" and not hide_directory_versions.get():
            directory_versions = get_versions_from_directory()
            filtered_versions.extend(directory_versions)

        version_combobox.destroy()

        version_combobox = CTk.CTkComboBox(master=app, values=[])
        version_combobox.place(x=540, y=450)

        CTkScrollableDropdown(version_combobox, values=filtered_versions, justify="left", button_color="transparent")

        if filtered_versions:
            last_version = settings.get("last_version", "")
            if last_version:
                version_combobox.set(last_version)
            else:
                version_combobox.set(filtered_versions[0] if filtered_versions else "")
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
            try:
                data = json.load(file)
                return data.get("accounts", [])
            except json.JSONDecodeError:
                return []
    return []

def save_accounts(accounts):
    with open(accounts_file, "w") as file:
        json.dump({"accounts": accounts}, file, indent=4)

def get_account_usernames():
    accounts = load_accounts()
    return [
        f"{acc['username']} (Ely.by)" if acc["type"] == "ely" 
        else f"{acc['username']} (оффлайн)" if acc["type"] == "offline" 
        else acc["username"]
        for acc in accounts
    ]
class FabricInstallThread(threading.Thread):
    def __init__(self, version_id, completion_callback, client_folder_name, custom_directory):
        super().__init__()
        self.version_id = version_id
        self.client_folder_name = client_folder_name
        self.completion_callback = completion_callback
        self.custom_directory = custom_directory

    def run(self):
        try:
            fabric_loader_version = get_latest_fabric_version()
            fabric_version_id = f"fabric-loader-{fabric_loader_version}-{self.version_id}"
            target_directory = self.custom_directory if self.custom_directory else minecraft_directory
            
            if self.client_folder_name:
                target_directory = os.path.join(target_directory, "clients", self.client_folder_name)
            else:
                print(f"Установка Fabric в обычную директорию: {target_directory}")
            
            version_path = os.path.join(target_directory, "versions", fabric_version_id)
            if os.path.exists(version_path):
                self.completion_callback(True, fabric_version_id)
                return

            progress_bar.start()
            progress_bar.place(x=5, y=430)
            install_fabric(self.version_id, target_directory, callback={
                'setStatus': set_status,
                'setProgress': set_progress,
                'setMax': set_max
            })
            self.completion_callback(True, fabric_version_id)
        except Exception as e:
            print(f"Ошибка установки Fabric: {e}")
            self.completion_callback(False, "")
        finally:
            progress_bar.stop()
            progress_bar.place_forget()
            enable_controls()

class QuiltInstallThread(threading.Thread):
    def __init__(self, version_id, completion_callback, client_folder_name, custom_directory):
        super().__init__()
        self.version_id = version_id
        self.client_folder_name = client_folder_name
        self.completion_callback = completion_callback
        self.custom_directory = custom_directory

    def run(self):
        try:
            quilt_loader_version = get_latest_quilt_version()
            quilt_version_id = f"quilt-loader-{quilt_loader_version}-{self.version_id}"
            target_directory = self.custom_directory if self.custom_directory else minecraft_directory
            
            if self.client_folder_name:
                target_directory = os.path.join(target_directory, "clients", self.client_folder_name)
            else:
                print(f"Установка Quilt в обычную директорию: {target_directory}")
            
            version_path = os.path.join(target_directory, "versions", quilt_version_id)
            if os.path.exists(version_path):
                self.completion_callback(True, quilt_version_id)
                return

            progress_bar.start()
            progress_bar.place(x=5, y=430)
            install_quilt(self.version_id, target_directory, callback={
                'setStatus': set_status,
                'setProgress': set_progress,
                'setMax': set_max
            })
            self.completion_callback(True, quilt_version_id)
        except Exception as e:
            print(f"Ошибка установки Quilt: {e}")
            self.completion_callback(False, "")
        finally:
            progress_bar.stop()
            progress_bar.place_forget()
            enable_controls()

class ForgeInstallThread(threading.Thread):
    def __init__(self, version_id, completion_callback, client_folder_name, custom_directory):
        super().__init__()
        self.version_id = version_id
        self.client_folder_name = client_folder_name
        self.completion_callback = completion_callback
        self.custom_directory = custom_directory

    def run(self):
        try:
            forge_version_id = forge.find_forge_version(self.version_id)
            if not forge_version_id:
                self.completion_callback(False, "")
                return
            
            correct_forge_version_id = f"{self.version_id}-forge-{forge_version_id.split('-')[-1]}"
            target_directory = custom_minecraft_directory.get() if custom_minecraft_directory.get() else minecraft_directory
            
            if self.client_folder_name:
                target_directory = os.path.join(target_directory, "clients", self.client_folder_name)
            else:
                print(f"Установка Forge в обычную директорию: {target_directory}")
            
            version_path = os.path.join(target_directory, "versions", correct_forge_version_id)
            if os.path.exists(version_path):
                self.completion_callback(True, correct_forge_version_id)
                return

            progress_bar.start()
            progress_bar.place(x=5, y=430)
            forge.install_forge_version(
                forge_version_id,
                target_directory,
                callback={
                    'setStatus': set_status,
                    'setProgress': set_progress,
                    'setMax': set_max
                }
            )
            self.completion_callback(True, correct_forge_version_id)
        except Exception as e:
            print(f"Ошибка установки Forge: {e}")
            self.completion_callback(False, "")
        finally:
            progress_bar.stop()
            progress_bar.place_forget()
            enable_controls()

def get_mod_count():
    mods_directory = os.path.join(minecraft_directory, "mods")
    try:
        mod_files = os.listdir(mods_directory)
        return len([f for f in mod_files if f.endswith('.jar') or f.endswith('.zip')])
    except Exception as e:
        print(f"Ошибка при подсчете модов: {e}")
        return 0

def is_quilt_installed(version_id, minecraft_directory):
    quilt_loader_prefix = "quilt-loader-"
    quilt_loader_suffix = f"-{version_id}"
    
    if not os.path.exists(minecraft_directory):
        return False
    
    for folder_name in os.listdir(minecraft_directory):
        if folder_name.startswith(quilt_loader_prefix) and folder_name.endswith(quilt_loader_suffix):
            return True
    
    return False

def launch_game():
    def run_install_and_launch():
        update_last_account(NickName.get())
        version_id = version_combobox.get()
        username = NickName.get()
        show_console = not hide_console_var.get()
        memory = selected_ram / 1024
        client_info = next((client for client in load_clients("clients.json") if client["name"] == version_id.split(" - ")[-1]), None)
        client_folder_name = None
        loader = selected_loader 
        minecraft_directory = custom_minecraft_directory.get()

        if version_id in get_versions_from_directory():
            loader = "Vanilla"

        if client_info:
            version_id = client_info["version"]
            client_folder_name = client_info['name']
            loader = client_info.get("loader", "Vanilla")
            print(f"Выбрана клиентская версия: {client_folder_name} (Версия: {version_id}) с {loader}")
        else:
            client_name = version_id
            print(f"Выбрана обычная версия: {client_name} с {loader}")

        disable_controls()

        def on_completion(success, loader_version_id):
            progress_bar.stop()
            if success:
                print(f"Установка {loader} завершена успешно. Запуск игры...")
                start_game(loader_version_id, username, show_console, memory, client_folder_name)
            else:
                print(f"Установка {loader} завершилась неудачно.")
                show_error_with_link("Ошибка установки", f"Установка {loader} завершилась неудачно.")
                enable_controls()

        progress_bar.place(x=5, y=430)
        if loader in ["Fabric", "Quilt", "Forge"]:
            progress_bar.start()
            print(f"Начало установки {loader}...")
            if loader == "Fabric":
                if is_version_installed(f"fabric-loader-{version_id}", minecraft_directory):
                    print(f"Fabric для версии {version_id} уже установлен.")
                    on_completion(True, version_id)
                else:
                    install_thread = FabricInstallThread(version_id, on_completion, client_folder_name, minecraft_directory)
                    install_thread.start()
            elif loader == "Quilt":
                if is_version_installed(f"quilt-loader-{version_id}", minecraft_directory):
                    print(f"Quilt для версии {version_id} уже установлен.")
                    on_completion(True, version_id)
                else:
                    install_thread = QuiltInstallThread(version_id, on_completion, client_folder_name, minecraft_directory)
                    install_thread.start()
            elif loader == "Forge":
                if is_version_installed(f"forge-{version_id}", minecraft_directory):
                    print(f"Forge для версии {version_id} уже установлен.")
                    on_completion(True, version_id)
                else:
                    install_thread = ForgeInstallThread(version_id, on_completion, client_folder_name, minecraft_directory)
                    install_thread.start()
        elif loader == "Vanilla":
            if is_version_installed(version_id, minecraft_directory):
                print(f"Vanilla версия {version_id} уже установлена.")
                on_completion(True, version_id)
            else:
                progress_bar.start()
                print("Начало установки Vanilla...")
                install_version(version_id, username, show_console, memory, client_folder_name if client_folder_name else "", minecraft_directory)
        else:
            print("Выбранный модлоадер не поддерживается.")
            show_error_with_link("Ошибка", "Выбранный модлоадер не поддерживается.")
            enable_controls()

    threading.Thread(target=run_install_and_launch, daemon=True).start()

def is_version_installed(version_id, minecraft_directory):
    versions_dir = os.path.join(minecraft_directory, "versions")
    version_folder = os.path.join(versions_dir, version_id)
    return os.path.exists(version_folder)

clients_directory = os.path.join(minecraft_directory, "clients")

def open_client_manager():
    client_manager_window = CTk.CTkToplevel(app)
    client_manager_window.title("Менеджер клиентов")
    client_manager_window.attributes("-topmost", True)
    client_manager_window.geometry("500x200")
    client_manager_window.resizable(False, False)  # Запрещаем изменение размера
    center_window(client_manager_window, 500, 200)
    
    ClientManager(client_manager_window, get_version_list, clients_directory, version_combobox)

def install_version(version_id, username, show_console, memory, client_folder_name, custom_directory):
    try:
        installation_path = custom_directory if custom_directory else minecraft_directory
        
        if client_folder_name:
            client_folder = os.path.join(installation_path, "clients", client_folder_name)
        else:
            client_folder = installation_path
        os.makedirs(client_folder, exist_ok=True)

        logging.info(f"Начало установки версии {version_id}...")
        install_minecraft_version(version_id, client_folder, callback={
            'setStatus': set_status,
            'setProgress': set_progress,
            'setMax': set_max
        })

        logging.info(f"Установка версии {version_id} завершена. Запуск игры...")
        start_game(version_id, username, show_console, memory, client_folder_name, custom_directory)
    except Exception as e:
        logging.error(f"Ошибка установки версии: {e}")
        show_error_with_link("Ошибка установки", f"Ошибка установки версии: {e}")
        progress_bar.stop()
        progress_bar.place_forget()
        enable_controls()

authlib_path= "Z:/Launcher/authlib-injector.jar"

def start_game(version_id, username, show_console, memory, client_folder_name=None, custom_directory=None):
    global minecraft_process
    memory = int(memory)
    clean_username = username.replace(" (Ely.by)", "").replace(" (оффлайн)", "").replace(" (Microsoft)", "")
    account_type = "ely" if "(Ely.by)" in username else "offline" if "(оффлайн)" in username else "microsoft"

    if account_type == "microsoft":
        accounts = load_microsoft_accounts()
    else:
        accounts = load_accounts()

    account_info = next((acc for acc in accounts if acc["username"] == clean_username and acc["type"] == account_type), None)

    if account_info is None:
        show_error_with_link("Ошибка", f"Аккаунт {clean_username} не найден.")
        return

    # Refresh Microsoft token if applicable
    if account_type == "microsoft" and "refresh_token" in account_info:
        try:
            refreshed_data = minecraft_launcher_lib.microsoft_account.complete_refresh(
                MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI,
                account_info["refresh_token"]
            )
            # Update the account info with new tokens
            account_info["access_token"] = refreshed_data["access_token"]
            account_info["refresh_token"] = refreshed_data["refresh_token"]
            
            # Save updated tokens to microsoft_accounts.json
            microsoft_accounts = load_microsoft_accounts()
            for i, acc in enumerate(microsoft_accounts):
                if acc["uuid"] == account_info["uuid"]:
                    microsoft_accounts[i] = account_info
                    break
            save_microsoft_accounts(microsoft_accounts)
        except Exception:
            pass  # Use existing access_token if refresh fails

    options = {
        'username': clean_username,
        'uuid': account_info.get('uuid', str(uuid1())),
        'jvmArguments': [f"-Xmx{memory}G", f"-Xms{memory}G"]
    }

    if account_type == "microsoft":
        options["token"] = account_info["access_token"]

    if account_type == "ely":
        options['jvmArguments'].append(f"-javaagent:{authlib_path}=https://account.Ely.by/api/authlib-injector")
    elif account_type == "offline":
        options['jvmArguments'].append(f"-javaagent:{authlib_path}=http://launcher.xneon.fun/launcher.json")

    if custom_java_path:
        options["executablePath"] = custom_java_path

    if custom_resolution_width and custom_resolution_height:
        options["customResolution"] = True
        options["resolutionWidth"] = custom_resolution_width
        options["resolutionHeight"] = custom_resolution_height

    creationflags = 0 if show_console else CREATE_NO_WINDOW
    version_rpc = version_id.split('-')[-1]
    state_text = f"Играет на версии {version_rpc}"
    details_text = "Запущен Xneon Launcher"
    update_discord_rpc(state_text, details_text)

    if client_folder_name:
        minecraft_directory_for_version = os.path.join(custom_directory if custom_directory else minecraft_directory, "clients", client_folder_name)
    else:
        minecraft_directory_for_version = custom_directory if custom_directory else minecraft_directory

    version_path = os.path.join(minecraft_directory_for_version, "versions", version_id)

    if not os.path.exists(version_path):
        show_error_with_link("Ошибка", f"Версия {version_id} не найдена в каталоге {minecraft_directory_for_version}")
        return

    try:
        minecraft_process = subprocess.Popen(
            get_minecraft_command(version=version_id, minecraft_directory=minecraft_directory_for_version, options=options),
            creationflags=creationflags
        )

        disable_controls()
        set_status("Minecraft Started")

        minecraft_process.wait()
        set_status("")
        progress_bar.place_forget()
        stop_button.place_forget()
        enable_controls()
        update_discord_rpc("Запущен Xneon Launcher", "Ожидание запуска...")

        if client_folder_name:
            versions_combobox_startvar.set(f"Custom - {client_folder_name}")
        else:
            versions_combobox_startvar.set(version_id)

        save_settings()
        minecraft_process = None
    except Exception as e:
        show_error_with_link("Ошибка запуска", f"Ошибка запуска игры: {e}")
        progress_bar.stop()
        progress_bar.place_forget()
        stop_button.place_forget()
        enable_controls()

        if client_folder_name:
            versions_combobox_startvar.set(f"Custom - {client_folder_name}")
        else:
            versions_combobox_startvar.set(version_id)

        save_settings()
        
    except Exception as e:
        logging.error(f"Ошибка запуска игры: {e}")
        show_error_with_link("Ошибка запуска", f"Ошибка запуска игры: {e}")
        progress_bar.stop()
        progress_bar.place_forget()
        enable_controls()

accounts_file = "accounts.json"

def load_microsoft_accounts():
    if os.path.exists(MICROSOFT_ACCOUNTS_FILE):
        with open(MICROSOFT_ACCOUNTS_FILE, "r") as file:
            try:
                data = json.load(file)
                return data.get("accounts", [])
            except json.JSONDecodeError:
                return []
    return []

def save_microsoft_accounts(accounts):
    with open(MICROSOFT_ACCOUNTS_FILE, "w") as file:
        json.dump({"accounts": accounts}, file, indent=4)

def load_accounts():
    if os.path.exists(accounts_file):
        with open(accounts_file, "r") as file:
            try:
                data = json.load(file)
                return data.get("accounts", [])
            except json.JSONDecodeError:
                return []
    return []

def save_accounts(accounts):
    with open(accounts_file, "w") as file:
        json.dump({"accounts": accounts}, file, indent=4)

def get_account_usernames():
    accounts = load_accounts()
    microsoft_accounts = load_microsoft_accounts()
    
    account_usernames = [
        f"{acc['username']} (Ely.by)" if acc["type"] == "ely"
        else f"{acc['username']} (оффлайн)" if acc["type"] == "offline"
        else acc["username"]
        for acc in accounts
    ]
    
    microsoft_usernames = [
        f"{acc['username']} (Microsoft)"
        for acc in microsoft_accounts
    ]
    
    return account_usernames + microsoft_usernames

def generate_random_nickname():
    nickname = generate()
    return nickname

def center_window(window, width, height):
    screen_width = window.winfo_screenwidth()
    screen_height = window.winfo_screenheight()
    x = (screen_width // 2) - (width // 2)
    y = (screen_height // 2) - (height // 2)
    window.geometry(f"{width}x{height}+{x}+{y}")

ELY_CLIENT_ID = "xneon-launcher"
ELY_CLIENT_SECRET = "bdYVIFcwtupXFxV5Ip_fQczn4Q7T3LiQq1zK-JYnHXjmGe7Krqv-IMYhu7HWy9aY"
ELY_REDIRECT_URI = "http://localhost:27482/callback"
ELY_SCOPES = "account_info minecraft_server_session"

MS_CLIENT_ID = "d84cc194-923c-458b-be2f-277abfbc3234"
MS_CLIENT_SECRET = "q158Q~URFHGL0wckxaJ8QXA-5fgxkzPxmOW2qaDE"
MS_REDIRECT_URI = "http://localhost:27482/ms_callback"

ACCOUNTS_FILE = "accounts.json"  # Для Ely.by и оффлайн
MICROSOFT_ACCOUNTS_FILE = "microsoft_accounts.json"  # Для Microsoft

PORT = 27482

class AccountManager:
    def __init__(self, master, update_last_account_callback, nickname_entry):
        self.master = master
        self.update_last_account_callback = update_last_account_callback
        self.nickname_entry = nickname_entry
        self.accounts = self.load_accounts()  # Ely.by и оффлайн
        self.microsoft_accounts = self.load_microsoft_accounts()  # Microsoft
        self.auth_data = {"code": None, "type": None, "state": None, "code_verifier": None}
        self.setup_ui()

    def setup_ui(self):
        self.master.geometry("400x200")
        self.center_window(self.master, 400, 200)
        self.master.title("Менеджер аккаунтов")

        self.main_frame = CTk.CTkFrame(self.master)
        self.main_frame.pack(fill="both", expand=True, padx=20, pady=20)

        self.title_label = CTk.CTkLabel(self.main_frame, text="Управление аккаунтами", font=("Arial", 16, "bold"))
        self.title_label.pack(pady=(0, 20))

        self.account_combobox = CTk.CTkComboBox(self.main_frame, values=self.get_account_usernames(), 
                                              command=self.update_nickname, width=250)
        self.account_combobox.pack(pady=(0, 20))

        self.button_frame = CTk.CTkFrame(self.main_frame, fg_color="transparent")
        self.button_frame.pack(fill="x")
        
        self.btn_add = CTk.CTkButton(self.button_frame, text="Добавить аккаунт", 
                                   command=self.open_add_account_dialog, width=120)
        self.btn_add.pack(side="left", padx=10)
        
        self.btn_remove = CTk.CTkButton(self.button_frame, text="Удалить аккаунт", 
                                      command=self.open_remove_account_dialog, width=120)
        self.btn_remove.pack(side="right", padx=10)

    def center_window(self, window, width, height):
        screen_width = window.winfo_screenwidth()
        screen_height = window.winfo_screenheight()
        x = (screen_width // 2) - (width // 2)
        y = (screen_height // 2) - (height // 2)
        window.geometry(f"{width}x{height}+{x}+{y}")

    def load_accounts(self):
        return self.load_json(ACCOUNTS_FILE, "accounts")

    def load_microsoft_accounts(self):
        return self.load_json(MICROSOFT_ACCOUNTS_FILE, "accounts")

    def load_json(self, filename, key):
        if os.path.exists(filename):
            with open(filename, "r") as file:
                try:
                    return json.load(file).get(key, [])
                except json.JSONDecodeError:
                    return []
        return []

    def save_accounts(self):
        with open(ACCOUNTS_FILE, "w") as file:
            json.dump({"accounts": self.accounts}, file, indent=4)

    def save_microsoft_accounts(self):
        with open(MICROSOFT_ACCOUNTS_FILE, "w") as file:
            json.dump({"accounts": self.microsoft_accounts}, file, indent=4)

    def get_account_usernames(self):
        usernames = []
        for acc in self.accounts:
            if acc["type"] == "ely":
                usernames.append(f"{acc['username']} (Ely.by)")
            elif acc["type"] == "offline":
                usernames.append(f"{acc['username']} (оффлайн)")
        for acc in self.microsoft_accounts:
            usernames.append(f"{acc['username']} (Microsoft)")
        return usernames

    def update_nickname(self, selected_account):
        clean_username = selected_account.split(" (")[0]
        account_type = selected_account.split(" (")[1][:-1].lower()
        if account_type == "microsoft":
            accounts = self.microsoft_accounts
            account_type = "microsoft"
        elif account_type == "ely.by":
            accounts = self.accounts
            account_type = "ely"
        elif account_type == "оффлайн":
            accounts = self.accounts
            account_type = "offline"
        
        account_info = next((acc for acc in accounts if acc["username"] == clean_username and acc["type"] == account_type), None)
        
        if account_info:
            self.nickname_entry.delete(0, CTk.END)
            self.nickname_entry.insert(0, selected_account)

    def open_add_account_dialog(self):
        self.master.withdraw()
        dialog = CTk.CTkToplevel(self.master)
        dialog.title("Выберите тип аккаунта")
        dialog.geometry("300x250")
        self.center_window(dialog, 300, 250)
        dialog.resizable(False, False)
        dialog.attributes("-topmost", True)

        frame = CTk.CTkFrame(dialog)
        frame.pack(fill="both", expand=True, padx=20, pady=20)

        CTk.CTkLabel(frame, text="Выберите тип аккаунта", font=("Arial", 14, "bold")).pack(pady=(0, 20))
        CTk.CTkButton(frame, text="Оффлайн", command=lambda: self.open_offline_dialog(dialog), width=200).pack(pady=10)
        CTk.CTkButton(frame, text="Ely.by", command=lambda: self.start_auth(dialog, "ely"), width=200).pack(pady=10)
        CTk.CTkButton(frame, text="Microsoft", command=lambda: self.start_auth(dialog, "ms"), width=200).pack(pady=10)

        dialog.protocol("WM_DELETE_WINDOW", lambda: [dialog.destroy(), self.master.deiconify()])

    def open_offline_dialog(self, previous_dialog):
        previous_dialog.destroy()
        dialog = CTk.CTkToplevel(self.master)
        dialog.title("Добавить оффлайн аккаунт")
        dialog.geometry("300x250")
        self.center_window(dialog, 300, 250)
        dialog.resizable(False, False)
        dialog.attributes("-topmost", True)

        frame = CTk.CTkFrame(dialog)
        frame.pack(fill="both", expand=True, padx=20, pady=20)

        CTk.CTkLabel(frame, text="Добавление оффлайн аккаунта", font=("Arial", 14, "bold")).pack(pady=(0, 20))
        entry = CTk.CTkEntry(frame, placeholder_text="Имя аккаунта", width=200)
        entry.pack(pady=10)

        def add_offline_account():
            name = entry.get()
            if name and not any(acc["username"] == name and acc["type"] == "offline" for acc in self.accounts):
                self.accounts.append({"type": "offline", "username": name})
                self.save_accounts()
                self.account_combobox.configure(values=self.get_account_usernames())
                self.update_last_account_callback(name)
                dialog.destroy()
                self.master.deiconify()

        CTk.CTkButton(frame, text="Добавить", command=add_offline_account, width=200).pack(pady=10)
        dialog.protocol("WM_DELETE_WINDOW", lambda: [dialog.destroy(), self.master.deiconify()])

    def start_auth(self, dialog, auth_type):
        dialog.destroy()
        self.auth_data = {"code": None, "type": None, "state": None, "code_verifier": None}
        
        server = socketserver.TCPServer(("", PORT), lambda *args, **kwargs: self.OAuthHandler(self, *args, **kwargs))
        threading.Thread(target=server.serve_forever, daemon=True).start()

        if auth_type == "ely":
            webbrowser.open(f"https://account.ely.by/oauth2/v1?client_id={ELY_CLIENT_ID}&redirect_uri={ELY_REDIRECT_URI}&response_type=code&scope={ELY_SCOPES}")
        else:
            login_url, state, code_verifier = mcl.microsoft_account.get_secure_login_data(MS_CLIENT_ID, MS_REDIRECT_URI)
            self.auth_data.update({"state": state, "code_verifier": code_verifier})
            webbrowser.open(login_url)

        threading.Thread(target=self.wait_for_auth, args=(server, auth_type), daemon=True).start()

    class OAuthHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, manager, *args, **kwargs):
            self.manager = manager
            super().__init__(*args, **kwargs)

        def do_GET(self):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "/callback" in self.path and "code" in query:
                self.manager.auth_data.update({"code": query["code"][0], "type": "ely"})
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Ely.by Success!")
            elif "/ms_callback" in self.path and "code" in query:
                self.manager.auth_data.update({"code": query["code"][0], "type": "ms", "state": query.get("state", [None])[0]})
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Microsoft Success!")

    def wait_for_auth(self, server, auth_type):
        while not self.auth_data["code"]:
            pass
        server.shutdown()
        server.server_close()

        try:
            if auth_type == "ely":
                token = requests.post("https://account.ely.by/api/oauth2/v1/token", data={
                    "client_id": ELY_CLIENT_ID,
                    "client_secret": ELY_CLIENT_SECRET,
                    "redirect_uri": ELY_REDIRECT_URI,
                    "grant_type": "authorization_code",
                    "code": self.auth_data["code"]
                }).json()
                user = requests.get("https://account.ely.by/api/account/v1/info", headers={
                    "Authorization": f"Bearer {token['access_token']}"
                }).json()
                account_data = {
                    "type": "ely",
                    "username": user["username"],
                    "uuid": user["uuid"],
                    "access_token": token["access_token"]
                }
                if not any(acc.get("uuid") == account_data["uuid"] for acc in self.accounts):
                    self.accounts.append(account_data)
                    self.save_accounts()
                    self.account_combobox.configure(values=self.get_account_usernames())
                    self.update_last_account_callback(account_data["username"])
                    CTkMessagebox(
                        title="Успех",
                        message=f"Аккаунт {account_data['username']} успешно добавлен!",
                        icon="check"
                    )
                else:
                    CTkMessagebox(
                        title="Ошибка",
                        message=f"Аккаунт {account_data['username']} уже добавлен!",
                        icon="warning"
                    )
            
            elif auth_type == "ms":
                login_data = mcl.microsoft_account.complete_login(
                    MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI,
                    self.auth_data["code"], self.auth_data["code_verifier"]
                )
                account_data = {
                    "type": "microsoft",
                    "username": login_data["name"],
                    "uuid": login_data["id"],
                    "access_token": login_data["access_token"],
                    "refresh_token": login_data["refresh_token"]  # Add refresh token
                }
                if not any(acc.get("uuid") == account_data["uuid"] for acc in self.microsoft_accounts):
                    self.microsoft_accounts.append(account_data)
                    self.save_microsoft_accounts()
                    self.account_combobox.configure(values=self.get_account_usernames())
                    self.update_last_account_callback(account_data["username"])
                    CTkMessagebox(
                        title="Успех",
                        message=f"Аккаунт {account_data['username']} успешно добавлен!",
                        icon="check"
                    )

                else:
                    CTkMessagebox(
                        title="Ошибка",
                        message=f"Аккаунт {account_data['username']} уже добавлен!",
                        icon="warning"
                    )

        except Exception as e:
            CTkMessagebox(
                title="Ошибка",
                message=f"Ошибка авторизации: {e}",
                icon="cancel"
            )

    def open_remove_account_dialog(self):
        if not self.accounts and not self.microsoft_accounts:
            CTkMessagebox(title="Ошибка", message="Нет доступных аккаунтов для удаления.", icon="cancel")
            return

        self.master.withdraw()

        dialog = CTk.CTkToplevel(self.master)
        dialog.title("Удалить аккаунт")
        dialog.geometry("300x250")
        self.center_window(dialog, 300, 250)
        dialog.resizable(False, False)
        dialog.attributes("-topmost", True)
        frame = CTk.CTkFrame(dialog)
        frame.pack(fill="both", expand=True, padx=20, pady=20)

        CTk.CTkLabel(frame, text="Удаление аккаунта", font=("Arial", 14, "bold")).pack(pady=(0, 20))

        account_combobox = CTk.CTkComboBox(frame, values=self.get_account_usernames(), width=200)
        account_combobox.pack(pady=20)

        if self.accounts or self.microsoft_accounts:
            account_combobox.set(self.get_account_usernames()[0])

        def remove_account_wrapper():
            self.remove_account(account_combobox.get())
            dialog.destroy()

        CTk.CTkButton(frame, text="Удалить", command=remove_account_wrapper, width=200).pack(pady=20)

        def on_dialog_close():
            dialog.destroy()
            self.master.deiconify()

        dialog.protocol("WM_DELETE_WINDOW", on_dialog_close)

    def remove_account(self, account_name):
        clean_username = account_name.replace(" (Ely.by)", "").replace(" (оффлайн)", "").replace(" (Microsoft)", "")
        account_type = "ely" if "(Ely.by)" in account_name else "offline" if "(оффлайн)" in account_name else "microsoft"

        if account_type == "microsoft":
            self.microsoft_accounts = [acc for acc in self.microsoft_accounts if not (acc["username"] == clean_username and acc["type"] == account_type)]
            self.save_microsoft_accounts()
        else:
            self.accounts = [acc for acc in self.accounts if not (acc["username"] == clean_username and acc["type"] == account_type)]
            self.save_accounts()

        self.account_combobox.configure(values=self.get_account_usernames())
        CTkMessagebox(title="Успех", message=f"Аккаунт {account_name} успешно удален!", icon="check")

if __name__ == "__main__":
    root = CTk.CTk()
    root.geometry("400x300")
    center_window(root, 400, 300)
    root.title("Менеджер аккаунтов")

    def update_last_account_callback(account_name):
        print(f"Последний выбранный аккаунт: {account_name}")

    nickname_entry = CTk.CTkEntry(root, placeholder_text="Никнейм")
    nickname_entry.pack(pady=10)

    account_manager = AccountManager(root, update_last_account_callback, nickname_entry)

    def update_last_account_callback(account_name):
        print(f"Последний выбранный аккаунт: {account_name}")

    nickname_entry = CTk.CTkEntry(root, placeholder_text="Никнейм")
    nickname_entry.pack(pady=10)

    account_manager = AccountManager(root, update_last_account_callback, nickname_entry)

def open_account_manager():
    account_manager_window = CTk.CTkToplevel(app)
    account_manager_window.title("Менеджер аккаунтов")
    account_manager_window.attributes("-topmost", True)
    account_manager_window.geometry("300x100")
    account_manager_window.resizable(False, False)
    
    center_window(account_manager_window, 300, 100)
    
    AccountManager(account_manager_window, update_last_account, NickName)

clients_file = "clients.json"
mods_clients_file = "mods_clients.json"

def save_clients(clients, file_path):
    with open(file_path, "w") as file:
        json.dump(clients, file, indent=4)

def load_clients(file_path):
    if os.path.exists(file_path):
        with open(file_path, "r") as file:
            content = file.read()
            if content.strip():
                return json.loads(content)
    return []

def create_client_folder(client_info, clients_directory):
    client_folder_name = client_info['name']
    client_folder = os.path.join(clients_directory, client_folder_name)
    if not os.path.exists(client_folder):
        os.makedirs(client_folder)
        CTkMessagebox(title="Успех", message=f"Клиент '{client_folder_name}' создан.", icon="check")
        
        clients = load_clients(clients_file)
        mods_clients = load_clients(mods_clients_file)
        
        if client_info not in clients:
            clients.append(client_info)
            save_clients(clients, clients_file)
        
        if client_info not in mods_clients:
            mods_clients.append(client_info)
            save_clients(mods_clients, mods_clients_file)
    else:
        CTkMessagebox(title="Ошибка", message=f"Клиент '{client_folder_name}' уже существует.", icon="cancel")
    return client_folder

def delete_client(client_name, clients_directory):
    client_folder_path = os.path.join(clients_directory, client_name)
    if os.path.exists(client_folder_path):
        shutil.rmtree(client_folder_path)
        
        clients = load_clients(clients_file)
        mods_clients = load_clients(mods_clients_file)
        
        clients = [client for client in clients if client['name'] != client_name]
        mods_clients = [client for client in mods_clients if client['name'] != client_name]
        
        save_clients(clients, clients_file)
        save_clients(mods_clients, mods_clients_file)
        
        CTkMessagebox(title="Успех", message=f"Клиент '{client_name}' удален.", icon="check")
    else:
        CTkMessagebox(title="Ошибка", message=f"Клиент '{client_name}' не найден.", icon="cancel")

def center_window(window, width, height):
    screen_width = window.winfo_screenwidth()
    screen_height = window.winfo_screenheight()
    x = (screen_width // 2) - (width // 2)
    y = (screen_height // 2) - (height // 2)
    window.geometry(f"{width}x{height}+{x}+{y}")

clients_file = "clients.json"
mods_clients_file = "mods_clients.json"

def save_clients(clients, file_path):
    with open(file_path, "w") as file:
        json.dump(clients, file, indent=4)

def load_clients(file_path):
    if os.path.exists(file_path):
        with open(file_path, "r") as file:
            content = file.read()
            if content.strip():
                return json.loads(content)
    return []

def create_client_folder(client_info, clients_directory):
    client_folder_name = client_info['name']
    client_folder = os.path.join(clients_directory, client_folder_name)
    if not os.path.exists(client_folder):
        os.makedirs(client_folder)
        CTkMessagebox(title="Успех", message=f"Клиент '{client_folder_name}' создан.", icon="check")
        
        clients = load_clients(clients_file)
        mods_clients = load_clients(mods_clients_file)
        
        if client_info not in clients:
            clients.append(client_info)
            save_clients(clients, clients_file)
        
        if client_info not in mods_clients:
            mods_clients.append(client_info)
            save_clients(mods_clients, mods_clients_file)
    else:
        CTkMessagebox(title="Ошибка", message=f"Клиент '{client_folder_name}' уже существует.", icon="cancel")
    return client_folder

def delete_client(client_name, clients_directory):
    client_folder_path = os.path.join(clients_directory, client_name)
    if os.path.exists(client_folder_path):
        shutil.rmtree(client_folder_path)
        
        clients = load_clients(clients_file)
        mods_clients = load_clients(mods_clients_file)
        
        clients = [client for client in clients if client['name'] != client_name]
        mods_clients = [client for client in mods_clients if client['name'] != client_name]
        
        save_clients(clients, clients_file)
        save_clients(mods_clients, mods_clients_file)
        
        CTkMessagebox(title="Успех", message=f"Клиент '{client_name}' удален.", icon="check")
    else:
        CTkMessagebox(title="Ошибка", message=f"Клиент '{client_name}' не найден.", icon="cancel")

class ClientManager:
    def open_install_mods_window(self):
        self.master.destroy()
        install_window = CTk.CTkToplevel(app)
        install_window.attributes("-topmost", True)
        install_mods(install_window)

    def __init__(self, master, get_version_list, clients_directory, version_combobox):
        self.master = master
        self.clients = load_clients(clients_file)
        self.get_version_list = get_version_list
        self.clients_directory = clients_directory
        self.version_combobox = version_combobox
        self.main_frame = CTk.CTkFrame(master)
        self.main_frame.pack(fill="both", expand=True, padx=20, pady=20)

        self.Client_combobox = CTk.CTkComboBox(
            self.main_frame,
            values=[client['name'] for client in self.clients],
            command=self.on_client_selected
        )
        self.Client_combobox.grid(row=0, column=0, columnspan=3, pady=20)

        self.btn_add_client = CTk.CTkButton(self.main_frame, text="Добавить клиент", command=self.open_add_client_dialog)
        self.btn_add_client.grid(row=1, column=0, padx=15, pady=10)

        self.install_mods = CTk.CTkButton(self.main_frame, text="Установить Моды", command=self.open_install_mods_window)
        self.install_mods.grid(row=1, column=1, padx=15, pady=10)

        self.btn_remove_client = CTk.CTkButton(self.main_frame, text="Удалить клиент", command=self.open_remove_client_dialog)
        self.btn_remove_client.grid(row=1, column=2, padx=15, pady=10)

        self.import_modpack = CTk.CTkButton(self.main_frame, text="Импорт Модпак", command=lambda: install_mrpack(self.master))
        self.import_modpack.grid(row=2, column=1, padx=15, pady=10)

        self.main_frame.grid_columnconfigure((0, 1, 2), weight=1)
        self.main_frame.grid_rowconfigure((0, 1, 2), weight=1)

    def on_client_selected(self, selected_client_name):
        self.version_combobox.set(f"Custom - {selected_client_name}")

    def open_add_client_dialog(self):
        self.master.withdraw()

        dialog = CTk.CTkToplevel(self.master)
        dialog.title("Добавить клиент")
        dialog.resizable(False, False)
        dialog.attributes("-topmost", True)
        center_window(dialog, 300, 350)

        CTk.CTkLabel(dialog, text="Введите имя клиента:").pack(pady=10)
        entry = CTk.CTkEntry(dialog, placeholder_text="Имя клиента")
        entry.pack(pady=10)
        CTk.CTkLabel(dialog, text="Выберите версию:").pack(pady=10)
        all_versions = self.get_version_list()
        version_ids = [version['id'] for version in all_versions]
        version_combobox = CTk.CTkComboBox(dialog, values=version_ids)
        version_combobox.pack(pady=10)

        CTk.CTkLabel(dialog, text="Выберите модлоадер:").pack(pady=10)
        loader_combobox = CTk.CTkComboBox(dialog, values=["Vanilla", "Forge", "Quilt", "Fabric"])
        loader_combobox.pack(pady=10)

        def update_version_combobox(loader):
            if loader == "Fabric":
                filtered_versions = [v for v in version_ids if v.startswith(("1.14.", "1.15.", "1.16.", "1.17.", "1.18.", "1.19.", "1.20.", "1.21."))]
            else:
                filtered_versions = version_ids
            version_combobox.configure(values=filtered_versions)
            if filtered_versions:
                version_combobox.set(filtered_versions[0])

        loader_combobox.bind("<<ComboboxSelected>>", lambda event: update_version_combobox(loader_combobox.get()))
        update_version_combobox(loader_combobox.get())

        CTk.CTkButton(dialog, text="Добавить",
                      command=lambda: self.add_client(entry.get(), version_combobox.get(), loader_combobox.get())).pack(pady=10)

        def on_dialog_close():
            dialog.destroy()
            self.master.deiconify()

        dialog.protocol("WM_DELETE_WINDOW", on_dialog_close)

    def add_client(self, client_name, version, loader):
        if client_name:
            client_info = {
                "name": client_name,
                "version": version,
                "loader": loader
            }
            create_client_folder(client_info, self.clients_directory)
            self.update_versions()
            self.master.destroy()

    def open_remove_client_dialog(self):
        if not self.clients:
            CTkMessagebox(title="Ошибка", message="Нет доступных клиентов для удаления.", icon="cancel")
            return

        self.master.withdraw()
        remove_dialog = CTk.CTkToplevel(self.master)
        remove_dialog.title("Удалить клиент")
        remove_dialog.resizable(False, False)
        remove_dialog.attributes("-topmost", True)
        center_window(remove_dialog, 250, 150)

        CTk.CTkLabel(remove_dialog, text="Выберите клиент для удаления:").pack(pady=10)
        self.remove_client_combobox = CTk.CTkComboBox(remove_dialog, values=[client['name'] for client in self.clients])
        self.remove_client_combobox.pack(pady=10)

        CTk.CTkButton(remove_dialog, text="Удалить", command=self.confirm_delete_client).pack(pady=10)

        def on_dialog_close():
            remove_dialog.destroy()
            self.master.deiconify()

        remove_dialog.protocol("WM_DELETE_WINDOW", on_dialog_close)

    def confirm_delete_client(self):
        selected_client = self.remove_client_combobox.get()
        if selected_client:
            delete_client(selected_client, self.clients_directory)
            self.update_versions()
            if self.version_combobox.get() == f"Custom - {selected_client}":
                self.version_combobox.set("")
            self.master.destroy()

    def update_versions(self):
        self.clients = load_clients(clients_file)
        self.Client_combobox.configure(values=[client['name'] for client in self.clients])

def install_mods(master):
    selected_client = None
    selected_site = "modrinth"
    CURSEFORGE_API_KEY = "$2a$10$3hglJmfUurMH4xB9mLt1nOOHyV8foo4K3v0/7iiMLPSAJ8iJVufxO"
    RESOURCEPACK_CLASS_ID = 12
    SHADER_CLASS_ID = 6552
    MOD_CLASS_ID = 6

    active_threads = []

    def load_mod_settings():
        global selected_client, selected_site
        if not os.path.exists("mod_custom_directory.json"):
            initial_settings = {
                "selected_client": None,
                "selected_site": "modrinth"
            }
            with open("mod_custom_directory.json", "w") as f:
                json.dump(initial_settings, f, indent=4)
        
        with open("mod_custom_directory.json", "r") as f:
            mod_settings = json.load(f)
            selected_site = mod_settings.get("selected_site", "modrinth")
            selected_client_name = mod_settings.get("selected_client")
            if selected_client_name and os.path.exists("mods_clients.json"):
                with open("mods_clients.json", "r") as f:
                    clients = json.load(f)
                    selected_client = next((client for client in clients if client["name"] == selected_client_name), None)

    def save_mod_settings():
        mod_settings = {
            "selected_client": selected_client["name"] if selected_client else None,
            "selected_site": selected_site
        }
        with open("mod_custom_directory.json", "w") as f:
            json.dump(mod_settings, f, indent=4)

    def get_download_path(item_type, selected_client):
        custom_dir = custom_minecraft_directory.get()
        if custom_dir:
            return os.path.join(custom_dir, "clients", selected_client["name"], f"{item_type}s")
        else:
            return os.path.join(os.path.expanduser("~"), "AppData", "Roaming", ".minecraft", "clients", selected_client["name"], f"{item_type}s")

    def search_curseforge_items(query, limit=20, item_type="mod", game_version=None, modloader=None):
        headers = {'x-api-key': CURSEFORGE_API_KEY}
        search_url = f'https://api.curseforge.com/v1/mods/search?gameId=432&searchFilter={query}&pageSize={limit}'
        if game_version:
            search_url += f'&gameVersion={game_version}'
        if modloader and modloader.lower() != "vanilla":
            search_url += f'&modLoaderType={modloader.upper()}'
        if item_type == "resourcepack":
            search_url += f'&classId={RESOURCEPACK_CLASS_ID}'
        elif item_type == "shader":
            search_url += f'&classId={SHADER_CLASS_ID}'
        elif item_type == "mod":
            search_url += f'&classId={MOD_CLASS_ID}'
        response = requests.get(search_url, headers=headers)
        return response.json().get("data", []) if response.status_code == 200 else []

    def fetch_top_items_curseforge(limit=20, item_type="mod", game_version=None, modloader=None):
        headers = {'x-api-key': CURSEFORGE_API_KEY}
        search_url = f'https://api.curseforge.com/v1/mods/search?gameId=432&pageSize={limit}&sortField=popularity&sortOrder=desc'
        if game_version:
            search_url += f'&gameVersion={game_version}'
        if modloader and modloader.lower() != "vanilla":
            search_url += f'&modLoaderType={modloader.upper()}'
        if item_type == "resourcepack":
            search_url += f'&classId={RESOURCEPACK_CLASS_ID}'
        elif item_type == "shader":
            search_url += f'&classId={SHADER_CLASS_ID}'
        elif item_type == "mod":
            search_url += f'&classId={MOD_CLASS_ID}'
        response = requests.get(search_url, headers=headers)
        return response.json().get("data", []) if response.status_code == 200 else []

    def download_curseforge_mod(mod_id, file_id, item_type, item_name):
        def download_thread():
            headers = {'x-api-key': CURSEFORGE_API_KEY}
            download_url = f'https://api.curseforge.com/v1/mods/{mod_id}/files/{file_id}/download-url'
            response = requests.get(download_url, headers=headers)
            if response.status_code == 200:
                file_url = response.json().get("data")
                filename = os.path.basename(file_url)
                path = get_download_path(item_type, selected_client)
                downJar(file_url, path, filename, item_type, item_name)
            else:
                print(f"Failed to get download URL for mod ID {mod_id} and file ID {file_id}.")
        
        thread = threading.Thread(target=download_thread, daemon=True)
        thread.start()
        active_threads.append(thread)

    def fetch_top_items_modrinth(limit=20, item_type="mod", game_version=None, modloader=None):
        facets = [f'["project_type:{item_type}"]']
        if game_version:
            facets.append(f'["versions:{game_version}"]')
        if modloader and modloader.lower() != "vanilla":
            facets.append(f'["categories:{modloader.lower()}"]')
        facets_str = f'[{",".join(facets)}]'
        search_url = f'https://api.modrinth.com/v2/search?limit={limit}&index=downloads&facets={facets_str}'
        response = requests.get(search_url)
        return response.json().get("hits", []) if response.status_code == 200 else []

    def search_items_modrinth(query, limit=20, item_type="mod", game_version=None, modloader=None):
        facets = []
        if modloader and modloader.lower() == "vanilla" and item_type == "mod":
            return []
        facets.append(f'["project_type:{item_type}"]')
        if game_version:
            facets.append(f'["versions:{game_version}"]')
        if modloader and modloader.lower() != "vanilla":
            facets.append(f'["categories:{modloader.lower()}"]')
        facets_str = f'[{",".join(facets)}]'
        search_url = f'https://api.modrinth.com/v2/search?query={query}&limit={limit}&index=relevance&facets={facets_str}'
        response = requests.get(search_url)
        return response.json().get("hits", []) if response.status_code == 200 else []

    def download_mod_modrinth(modname, item_type, gameVersion, modloader, item_name):
        def download_thread():
            search_url = f'https://api.modrinth.com/v2/project/{modname}/version?game_versions=["{gameVersion}"]'
            if item_type != "resourcepack" and item_type != "shader":
                search_url += f'&loaders=["{modloader.lower()}"]'
            data = requests.get(search_url).json()
            if not data or not data[0].get("files"):
                print(f"No files found for {item_type} '{modname}' with game version '{gameVersion}'.")
                return
            fileurl = data[0]["files"][0]["url"]
            filename = os.path.basename(fileurl)
            path = get_download_path(item_type, selected_client)
            downJar(fileurl, path, filename, item_type, item_name)
        
        thread = threading.Thread(target=download_thread, daemon=True)
        thread.start()
        active_threads.append(thread)

    def downJar(url, path, filename, item_type, item_name):
        os.makedirs(path, exist_ok=True)
        full_path = os.path.join(path, filename)
        data = requests.get(url)
        with open(full_path, 'wb') as file:
            file.write(data.content)
        print("Download complete")
        
        # Определяем тип элемента для сообщения
        if item_type == "mod":
            display_type = "Мод"
        elif item_type == "resourcepack":
            display_type = "Ресурс-Пак"
        elif item_type == "shader":
            display_type = "Шейдер"
        else:
            display_type = "Элемент"
        
        CTkMessagebox(
            title="Успешная установка",
            message=f"{display_type} {item_name} успешно установлен!",
            icon="check"
        )

    def load_image(url, size=(50, 50)):
        response = requests.get(url)
        img = Image.open(BytesIO(response.content)).resize(size, Image.Resampling.LANCZOS)
        return CTk.CTkImage(img)

    def display_top_items(tab, items, details_frame, item_type):
        for i, item in enumerate(items):
            tile_frame = CTk.CTkFrame(tab, width=150, height=100, corner_radius=10)
            tile_frame.grid(row=i//4, column=i%4, padx=10, pady=10, sticky="nsew")
            icon = load_image(item["logo"]["url"] if "logo" in item and item["logo"]["url"] else item["icon_url"])
            if icon:
                CTk.CTkLabel(tile_frame, image=icon, text="").place(relx=0.5, rely=0.3, anchor="center")
            item_name = item['name'] if "name" in item else item['title']
            CTk.CTkLabel(tile_frame, text=item_name, wraplength=130, justify="center").place(relx=0.5, rely=0.8, anchor="center")
            tile_frame.bind("<Button-1>", lambda e, item=item, item_type=item_type: show_mod_details(details_frame, item, item_type))

    def show_mod_details(details_frame, item, item_type):
        for widget in details_frame.winfo_children():
            widget.destroy()
        
        description = item.get('summary', item.get('description', 'No description available'))
        CTk.CTkLabel(details_frame, text=description, wraplength=350, justify="center").pack(pady=10)
        
        author = item.get('authors', [{}])[0].get('name', 'Unknown Author') if selected_site == "curseforge" else item.get('author', 'Unknown Author')
        CTk.CTkLabel(details_frame, text=f"Author: {author}", wraplength=350, justify="center").pack(pady=10)
        
        if selected_site == "curseforge":
            file_size_bytes = item.get('latestFiles', [{}])[0].get('fileLength', 0)
        else:
            version_url = f"https://api.modrinth.com/v2/project/{item['slug']}/version"
            version_response = requests.get(version_url)
            file_size_bytes = version_response.json()[0].get('files', [{}])[0].get('size', 0) if version_response.status_code == 200 and version_response.json() else 0
        
        file_size_mb = file_size_bytes / (1024 * 1024)
        CTk.CTkLabel(details_frame, text=f"File Size: {file_size_mb:.2f} MB", wraplength=350, justify="center").pack(pady=10)
        
        item_name = item['name'] if "name" in item else item['title']
        if selected_site == "curseforge":
            CTk.CTkButton(details_frame, text="Скачать", command=lambda: download_curseforge_mod(item['id'], item['latestFiles'][0]['id'], item_type, item_name)).pack(pady=10)
        else:
            CTk.CTkButton(details_frame, text="Скачать", command=lambda: download_mod_modrinth(item['slug'], item_type, selected_client["version"], selected_client["loader"], item_name)).pack(pady=10)

    def set_site(site, tabview, details_frame, clients):
        global selected_site
        selected_site = site
        save_mod_settings()
        start_client_update_thread(selected_client["name"], clients, tabview, details_frame)

    def update_site_buttons(modrinth_radio, curseforge_radio):
        if selected_client:
            modrinth_radio.configure(state="normal")
            if "pre" in selected_client["version"] or "rc" in selected_client["version"] or "snapshot" in selected_client["version"]:
                curseforge_radio.configure(state="disabled")
            else:
                curseforge_radio.configure(state="normal")

    def update_client(choice, clients, tabview, details_frame):
        global selected_client
        selected_client = next(client for client in clients if client["name"] == choice)
        save_mod_settings()
        for tab in tabview.tab("Моды").winfo_children():
            tab.destroy()
        for tab in tabview.tab("Ресурс-паки").winfo_children():
            tab.destroy()
        for tab in tabview.tab("Шейдеры").winfo_children():
            tab.destroy()

        if selected_site == "curseforge":
            if selected_client["loader"] != "Vanilla":
                mods = fetch_top_items_curseforge(limit=12, item_type="mod", game_version=selected_client["version"], modloader=selected_client["loader"])
                display_top_items(tabview.tab("Моды"), mods, details_frame, item_type="mod")
            resourcepacks = fetch_top_items_curseforge(limit=12, item_type="resourcepack", game_version=selected_client["version"])
            display_top_items(tabview.tab("Ресурс-паки"), resourcepacks, details_frame, item_type="resourcepack")
            shaders = fetch_top_items_curseforge(limit=12, item_type="shader", game_version=selected_client["version"])
            display_top_items(tabview.tab("Шейдеры"), shaders, details_frame, item_type="shader")
        else:
            if selected_client["loader"] != "Vanilla":
                mods = fetch_top_items_modrinth(limit=12, item_type="mod", game_version=selected_client["version"], modloader=selected_client["loader"])
                display_top_items(tabview.tab("Моды"), mods, details_frame, item_type="mod")
            resourcepacks = fetch_top_items_modrinth(limit=12, item_type="resourcepack", game_version=selected_client["version"])
            display_top_items(tabview.tab("Ресурс-паки"), resourcepacks, details_frame, item_type="resourcepack")
            shaders = fetch_top_items_modrinth(limit=12, item_type="shader", game_version=selected_client["version"])
            display_top_items(tabview.tab("Шейдеры"), shaders, details_frame, item_type="shader")

    def perform_search(query, tabview, details_frame):
        global selected_client
        selected_tab = tabview.get()
        
        if selected_tab == "Моды" and selected_client["loader"] == "Vanilla":
            return

        for widget in tabview.tab(selected_tab).winfo_children():
            widget.destroy()

        if not query.strip():
            if selected_tab == "Моды":
                item_type = "mod"
            elif selected_tab == "Ресурс-паки":
                item_type = "resourcepack"
            elif selected_tab == "Шейдеры":
                item_type = "shader"

            if selected_site == "curseforge":
                items = fetch_top_items_curseforge(limit=12, item_type=item_type, game_version=selected_client["version"])
            else:
                items = fetch_top_items_modrinth(limit=12, item_type=item_type, game_version=selected_client["version"])

            display_top_items(tabview.tab(selected_tab), items, details_frame, item_type=item_type)
            return

        if selected_site == "curseforge":
            if selected_tab == "Моды":
                mods = search_curseforge_items(query, limit=12, item_type="mod", game_version=selected_client["version"], modloader=selected_client["loader"])
                display_top_items(tabview.tab(selected_tab), mods, details_frame, item_type="mod")
            elif selected_tab == "Ресурс-паки":
                resourcepacks = search_curseforge_items(query, limit=12, item_type="resourcepack", game_version=selected_client["version"])
                display_top_items(tabview.tab(selected_tab), resourcepacks, details_frame, item_type="resourcepack")
            elif selected_tab == "Шейдеры":
                shaders = search_curseforge_items(query, limit=12, item_type="shader", game_version=selected_client["version"])
                display_top_items(tabview.tab(selected_tab), shaders, details_frame, item_type="shader")
        else:
            if selected_tab == "Моды":
                mods = search_items_modrinth(query, limit=12, item_type="mod", game_version=selected_client["version"], modloader=selected_client["loader"])
                display_top_items(tabview.tab(selected_tab), mods, details_frame, item_type="mod")
            elif selected_tab == "Ресурс-паки":
                resourcepacks = search_items_modrinth(query, limit=12, item_type="resourcepack", game_version=selected_client["version"])
                display_top_items(tabview.tab(selected_tab), resourcepacks, details_frame, item_type="resourcepack")
            elif selected_tab == "Шейдеры":
                shaders = search_items_modrinth(query, limit=12, item_type="shader", game_version=selected_client["version"])
                display_top_items(tabview.tab(selected_tab), shaders, details_frame, item_type="shader")

    def start_client_update_thread(choice, clients, tabview, details_frame):
        update_client(choice, clients, tabview, details_frame)

    def start_search_thread(query, tabview, details_frame):
        thread = threading.Thread(target=perform_search, args=(query, tabview, details_frame), daemon=True)
        thread.start()
        active_threads.append(thread)

    load_mod_settings()
    if not selected_client:
        if os.path.exists("mods_clients.json"):
            with open("mods_clients.json", "r") as f:
                clients = json.load(f)
            selected_client = clients[0] if clients else None
        else:
            CTkMessagebox(title="Ошибка", message="Файл mods_clients.json не найден или пуст. Добавьте клиентов в mods_clients.json.", icon="cancel")
            return

    if not selected_client:
        CTkMessagebox(title="Ошибка", message="Нет доступных клиентов в mods_clients.json.", icon="cancel")
        return

    master.title("Установка Модов")
    master.geometry("1000x700")
    master.resizable(False, False)
    center_window(master, 1000, 700)

    tabview = CTk.CTkTabview(master)
    tabview.pack(fill="both", expand=True, padx=10, pady=10)
    details_frame = CTk.CTkFrame(master, width=400, height=300)
    details_frame.pack(side="right", fill="both", expand=True, padx=10, pady=10)

    mods_tab = tabview.add("Моды")
    resourcepacks_tab = tabview.add("Ресурс-паки")
    shaders_tab = tabview.add("Шейдеры")

    search_frame = CTk.CTkFrame(master)
    search_frame.pack(fill="x", padx=10, pady=25)
    CTk.CTkLabel(search_frame, text="Поиск:").pack(side="left", padx=(0, 10))
    search_entry = CTk.CTkEntry(search_frame, width=300)
    search_entry.pack(side="left", padx=(0, 10))
    CTk.CTkButton(search_frame, text="Искать", command=lambda: start_search_thread(search_entry.get(), tabview, details_frame)).pack(side="left")

    client_frame = CTk.CTkFrame(master)
    client_frame.pack(fill="x", padx=10, pady=25)
    CTk.CTkLabel(client_frame, text="Клиент:").pack(side="left", padx=(0, 10))
    with open("mods_clients.json", "r") as f:
        clients = json.load(f)
    client_combobox = CTk.CTkComboBox(client_frame, values=[client["name"] for client in clients], command=lambda choice: (start_client_update_thread(choice, clients, tabview, details_frame), update_site_buttons(modrinth_radio, curseforge_radio)))
    client_combobox.pack(side="left")
    client_combobox.set(selected_client["name"])

    site_frame = CTk.CTkFrame(master)
    site_frame.pack(fill="x", padx=10, pady=25)
    CTk.CTkLabel(site_frame, text="Платформа:").pack(side="left", padx=(0, 10))
    site_var = CTk.StringVar(value=selected_site)

    modrinth_radio = CTk.CTkRadioButton(site_frame, text="Modrinth", variable=site_var, value="modrinth", command=lambda: set_site(site_var.get(), tabview, details_frame, clients))
    modrinth_radio.configure(fg_color="#2ECC71", hover_color="#27AE60")
    modrinth_radio.pack(side="left")

    curseforge_radio = CTk.CTkRadioButton(site_frame, text="CurseForge", variable=site_var, value="curseforge", command=lambda: set_site(site_var.get(), tabview, details_frame, clients))
    curseforge_radio.configure(fg_color="#F39C12", hover_color="#E67E22")
    curseforge_radio.pack(side="left")

    update_site_buttons(modrinth_radio, curseforge_radio)
    start_client_update_thread(selected_client["name"], clients, tabview, details_frame)

    def on_closing():
        for thread in active_threads:
            if thread.is_alive():
                thread.join(timeout=1.0)
        master.destroy()
        if 'auth' in globals():
            auth.quit()

    master.protocol("WM_DELETE_WINDOW", on_closing)
    
def install_mrpack(client_manager_window=None):
    CURSEFORGE_API_API_KEY = "$2a$10$3hglJmfUurMH4xB9mLt1nOOHyV8foo4K3v0/7iiMLPSAJ8iJVufxO"
    modrinthHeaders = {"User-Agent": "Modpack Installer"}

    if client_manager_window:
        client_manager_window.destroy()

    def download_mod(url, path, output):
        try:
            response = requests.get(url, headers=modrinthHeaders)
            with open(path, 'wb') as file:
                file.write(response.content)
            output.append(f"Downloaded: {os.path.basename(path)}")
        except Exception as e:
            output.append(f"Error downloading {path}: {e}")

    def install_curseforge(directory, modpack, output):
        temp_dir = os.path.join(os.curdir, ".curseforgeInstallerTemp")
        try:
            os.makedirs(temp_dir, exist_ok=True)
            with zipfile.ZipFile(modpack, 'r') as zip_file:
                zip_file.extractall(temp_dir)

            manifest_path = os.path.join(temp_dir, "manifest.json")
            if not os.path.isfile(manifest_path):
                output.append("Ошибка: Не удалось найти manifest.json. Это не CurseForge модпак.")
                return

            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            minecraft_version = manifest.get("minecraft", {}).get("version")
            modloader = manifest.get("minecraft", {}).get("modLoaders", [{}])[0].get("id", "").split("-")[0]

            client_name = os.path.splitext(os.path.basename(modpack))[0]

            client_directory = os.path.join(directory, "clients", client_name)
            os.makedirs(client_directory, exist_ok=True)

            overrides_folder = os.path.join(temp_dir, manifest.get("overrides", ""))
            if os.path.isdir(overrides_folder):
                for filename in os.listdir(overrides_folder):
                    shutil.move(os.path.join(overrides_folder, filename), os.path.join(client_directory, filename))

            os.makedirs(os.path.join(client_directory, "mods"), exist_ok=True)

            output.append(f"Downloading {len(manifest['files'])} mods...")
            for i, file_info in enumerate(manifest["files"]):
                project_id = file_info["projectID"]
                file_id = file_info["fileID"]

                mod_data = requests.get(
                    f"{"https://api.curseforge.com"}/v1/mods/{project_id}",
                    headers={"x-api-key": CURSEFORGE_API_API_KEY}
                ).json()
                if not mod_data.get("data"):
                    output.append(f"[ERROR] Не удалось получить информацию о моде {project_id}.")
                    continue

                file_data = requests.get(
                    f"{"https://api.curseforge.com"}/v1/mods/{project_id}/files/{file_id}",
                    headers={"x-api-key": CURSEFORGE_API_API_KEY}
                ).json()
                if not file_data.get("data"):
                    output.append(f"[ERROR] Не удалось получить информацию о файле {file_id} для мода {project_id}.")
                    continue

                mod_file_name = file_data["data"]["fileName"]
                mod_file_path = os.path.join(client_directory, "mods", mod_file_name)
                download_url = file_data["data"]["downloadUrl"]

                try:
                    download_mod(download_url, mod_file_path, output)
                    output.append(f"Downloaded: {mod_file_name}")
                except Exception as e:
                    output.append(f"Error downloading {mod_file_name}: {e}")

                output.incrementProgressBar()

            clients = load_clients("clients.json")
            new_client = {
                "name": client_name,
                "version": minecraft_version,
                "loader": modloader
            }
            clients.append(new_client)
            save_clients(clients, "clients.json")

            mods_clients = load_clients("mods_clients.json")
            mods_clients.append(new_client)
            save_clients(mods_clients, "mods_clients.json")

            output.append("Done.")
        except Exception as e:
            output.append(f"Failed: {e}")
        finally:
            try:
                shutil.rmtree(temp_dir)
            except OSError as e:
                output.append(f"Error removing temp directory: {e}")

    def install(directory, modpack, output):
        if modpack.endswith(".mrpack"):
            temp_dir = os.path.join(os.curdir, ".modrinthInstallerTemp")
            try:
                os.makedirs(temp_dir, exist_ok=True)
                with zipfile.ZipFile(modpack, 'r') as zip_file:
                    zip_file.extractall(temp_dir)

                index_path = os.path.join(temp_dir, "modrinth.index.json")
                with open(index_path, 'r', encoding='utf-8') as f:
                    index_data = json.load(f)

                minecraft_version = index_data.get("dependencies", {}).get("minecraft")
                if not minecraft_version:
                    output.append("Ошибка: Не удалось определить версию Minecraft в modrinth.index.json.")
                    return

                dependencies = index_data.get("dependencies", {})
                if "fabric-loader" in dependencies:
                    modloader = "Fabric"
                elif "quilt_loader" in dependencies:
                    modloader = "Quilt"
                elif "forge" in dependencies:
                    modloader = "Forge"
                else:
                    modloader = "Vanilla"

                client_name = os.path.splitext(os.path.basename(modpack))[0]

                client_directory = os.path.join(directory, "clients", client_name)
                os.makedirs(client_directory, exist_ok=True)

                overrides_folder = os.path.join(temp_dir, "overrides")
                if os.path.isdir(overrides_folder):
                    for filename in os.listdir(overrides_folder):
                        shutil.move(os.path.join(overrides_folder, filename), os.path.join(client_directory, filename))

                os.makedirs(os.path.join(client_directory, "mods"), exist_ok=True)

                output.append(f"Downloading {len(index_data['files'])} mods...")
                for i, file_data in enumerate(index_data["files"]):
                    download_mod(file_data["downloads"][0], os.path.join(client_directory, file_data["path"]), output)
                    output.incrementProgressBar()

                clients = load_clients("clients.json")
                new_client = {
                    "name": client_name,
                    "version": minecraft_version,
                    "loader": modloader
                }
                clients.append(new_client)
                save_clients(clients, "clients.json")

                mods_clients = load_clients("mods_clients.json")
                mods_clients.append(new_client)
                save_clients(mods_clients, "mods_clients.json")

                output.append("Done.")
            except Exception as e:
                output.append(f"Failed: {e}")
            finally:
                try:
                    shutil.rmtree(temp_dir)
                except OSError as e:
                    output.append(f"Error removing temp directory: {e}")
        elif modpack.endswith(".zip"):
            install_curseforge(directory, modpack, output)
        else:
            output.append("Ошибка: Неподдерживаемый формат модпака. Используйте .mrpack (Modrinth) или .zip (CurseForge).")

    def set_modpack(entry):
        entry.delete(0, CTk.END)
        entry.insert(0, CTk.filedialog.askopenfilename(
            filetypes=[("Modrinth Pack", "*.mrpack"), ("CurseForge Pack", "*.zip"), ("All Files", "*.*")]
        ))

    def run_install():
        modpack_path = modpack_entry.get()
        if not modpack_path:
            CTkMessagebox(title="Ошибка", message="Модпак не выбран.", icon="cancel")
            return

        threading.Thread(target=lambda: install(custom_minecraft_directory.get(), modpack_path, output)).start()

    install_window = CTk.CTk()
    install_window.title("Установить Мод-пак")
    install_window.geometry("600x450")
    install_window.resizable(False, False)  # Запрещаем изменение размера
    center_window(install_window, 600, 450)

    modpack_entry = CTk.CTkEntry(install_window, width=400)
    modpack_entry.pack(pady=10)
    CTk.CTkButton(install_window, text="Выбрать модпак", command=lambda: set_modpack(modpack_entry)).pack(pady=10)

    output = CTk.CTkTextbox(install_window, width=550, height=250)
    output.pack(pady=10)

    progress = CTk.CTkProgressBar(install_window, width=550, mode="determinate")
    progress.pack(pady=10)

    output.append = lambda msg: output.insert(CTk.END, msg + "\n") or output.see(CTk.END)
    output.incrementProgressBar = lambda: progress.step()

    CTk.CTkButton(install_window, text="Установить", command=run_install).pack(pady=10)

    install_window.mainloop()


if __name__ == "__main__":
    root = CTk.CTk()
    root.geometry("400x300")
    center_window(root, 400, 300)
    root.title("Менеджер клиентов")


    def get_version_list():
        return [{"id": "1.19.2"}, {"id": "1.18.2"}, {"id": "1.17.1"}]

    client_manager = ClientManager(root, get_version_list, "clients_directory", CTk.CTkComboBox(root))
            
def update_nickname(selected_account):
    clean_username = selected_account.replace(" (Ely.by)", "").replace(" (оффлайн)", "")
    
    account_type = "ely" if "(Ely.by)" in selected_account else "offline" if "(оффлайн)" in selected_account else ""
    
    accounts = load_accounts()
    
    account_info = next((acc for acc in accounts if acc["username"] == clean_username and acc["type"] == account_type), None)
    
    if account_info:
        NickName.delete(0, CTk.END)
        
        if account_info["type"] == "ely":
            display_name = f"{clean_username} (Ely.by)"
        elif account_info["type"] == "offline":
            display_name = f"{clean_username} (оффлайн)"
        else:
            display_name = clean_username
        
        NickName.insert(0, display_name)

def update_nickname(self, selected_account):
    update_nickname(selected_account)

def update_loader(value):
    global selected_loader
    selected_loader = value
    save_settings()
    load_versions()

settings_frame = CTk.CTkFrame(master=app, width=450, height=490, corner_radius=10)
settings_frame.place(x=460, y=5)
CTk.CTkLabel(settings_frame, text="Настройки", font=("Arial", 16)).place(x=10, y=10)  

custom_minecraft_directory = CTk.StringVar(value=minecraft_launcher_lib.utils.get_minecraft_directory())

def select_directory():
    directory = filedialog.askdirectory()
    if directory:
        custom_minecraft_directory.set(directory)

client_manager_button = CTk.CTkButton(master=settings_frame, text="🎮", command=open_client_manager, width=30, height=30)
client_manager_button.place(x=385, y=10)

def update_ram_label(value, ram_label):
    global selected_ram
    selected_ram = int(value)
    ram_label.configure(text=f"Выбрано RAM: {selected_ram} MB")
    save_settings()

custom_java_path = None

def open_settings_window():
    app.withdraw()
    settings_window = CTk.CTkToplevel(app)
    settings_window.title("Настройки")
    settings_window.geometry("920x500")
    settings_window.resizable(False, False)

    center_window(settings_window, 920, 500)

    def on_close():
        settings_window.destroy()
        app.deiconify()

    settings_window.protocol("WM_DELETE_WINDOW", on_close)

    CTk.CTkLabel(settings_window, text="Основные настройки", font=("Arial", 14, "bold")).place(x=10, y=10)
    CTk.CTkLabel(settings_window, text=f"Максимально доступно ОЗУ: {max_ram} MB").place(x=10, y=40)
    ram_scale = CTk.CTkSlider(
        settings_window,
        from_=512,
        to=max_ram,
        number_of_steps=(max_ram - 512) // 512,
    )
    ram_scale.place(x=10, y=70)
    ram_scale.set(selected_ram)

    ram_value_label = CTk.CTkLabel(settings_window, text=f"Выбрано RAM: {selected_ram} MB")
    ram_value_label.place(x=10, y=100)

    ram_scale.configure(command=lambda value: update_ram_label(value, ram_value_label))

    CTk.CTkLabel(settings_window, text="Кастомный путь к Minecraft:").place(x=10, y=140)
    custom_directory_entry = CTk.CTkEntry(settings_window, textvariable=custom_minecraft_directory, width=250)
    custom_directory_entry.place(x=10, y=170)

    def select_directory():
        directory = filedialog.askdirectory()
        if directory:
            custom_minecraft_directory.set(directory)

    CTk.CTkButton(settings_window, text="Выбрать путь", command=select_directory).place(x=270, y=170)

    CTk.CTkLabel(settings_window, text="Скрыть версии:").place(x=10, y=210)
    hide_old_beta_checkbox = CTk.CTkCheckBox(settings_window, text="Убрать Beta", variable=hide_old_beta, command=load_versions)
    hide_old_beta_checkbox.place(x=10, y=240)
    hide_release_checkbox = CTk.CTkCheckBox(settings_window, text="Убрать Release", variable=hide_release, command=load_versions)
    hide_release_checkbox.place(x=10, y=270)
    hide_snapshot_checkbox = CTk.CTkCheckBox(settings_window, text="Убрать Snapshot", variable=hide_snapshot, command=load_versions)
    hide_snapshot_checkbox.place(x=10, y=300)
    hide_old_alpha_checkbox = CTk.CTkCheckBox(settings_window, text="Убрать Alpha", variable=hide_old_alpha, command=load_versions)
    hide_old_alpha_checkbox.place(x=10, y=330)
    hide_directory_versions_checkbox = CTk.CTkCheckBox(settings_window, text="Скрыть версии из директории", variable=hide_directory_versions, command=load_versions)
    hide_directory_versions_checkbox.place(x=10, y=360)

    hide_console_checkbox = CTk.CTkCheckBox(settings_window, text="Скрыть консоль", variable=hide_console_var)
    hide_console_checkbox.place(x=10, y=390)

    CTk.CTkLabel(settings_window, text="Дополнительные настройки", font=("Arial", 14, "bold")).place(x=480, y=10)

    CTk.CTkLabel(settings_window, text="Кастомное разрешение:").place(x=480, y=40)
    CTk.CTkLabel(settings_window, text="Ширина:").place(x=480, y=70)

    def validate_input(new_value):
        return new_value.isdigit() or new_value == ""

    resolution_width_entry = CTk.CTkEntry(
        settings_window,
        width=100,
    )
    resolution_width_entry.place(x=550, y=70)
    resolution_width_entry.insert(0, custom_resolution_width if custom_resolution_width else "")

    resolution_width_entry.configure(validate="key", validatecommand=(settings_window.register(validate_input), "%P"))

    CTk.CTkLabel(settings_window, text="Высота:").place(x=480, y=100)

    resolution_height_entry = CTk.CTkEntry(
        settings_window,
        width=100,
    )
    resolution_height_entry.place(x=550, y=100)
    resolution_height_entry.insert(0, custom_resolution_height if custom_resolution_height else "")

    resolution_height_entry.configure(validate="key", validatecommand=(settings_window.register(validate_input), "%P"))

    def set_resolution_preset(value):
        if value == "2K (2560x1440)":
            resolution_width_entry.delete(0, CTk.END)
            resolution_width_entry.insert(0, "2560")
            resolution_height_entry.delete(0, CTk.END)
            resolution_height_entry.insert(0, "1440")
        elif value == "Full HD (1920x1080)":
            resolution_width_entry.delete(0, CTk.END)
            resolution_width_entry.insert(0, "1920")
            resolution_height_entry.delete(0, CTk.END)
            resolution_height_entry.insert(0, "1080")
        elif value == "HD (1280x720)":
            resolution_width_entry.delete(0, CTk.END)
            resolution_width_entry.insert(0, "1280")
            resolution_height_entry.delete(0, CTk.END)
            resolution_height_entry.insert(0, "720")

    resolution_presets = CTk.CTkSegmentedButton(
        settings_window,
        values=["2K (2560x1440)", "Full HD (1920x1080)", "HD (1280x720)"],
        command=set_resolution_preset,
    )
    resolution_presets.place(x=480, y=140)

    current_resolution = f"{custom_resolution_width}x{custom_resolution_height}" if custom_resolution_width and custom_resolution_height else None
    if current_resolution == "2560x1440":
        resolution_presets.set("2K (2560x1440)")
    elif current_resolution == "1920x1080":
        resolution_presets.set("Full HD (1920x1080)")
    elif current_resolution == "1280x720":
        resolution_presets.set("HD (1280x720)")
    else:
        resolution_presets.set(None)

    CTk.CTkLabel(settings_window, text="Кастомный путь к Java:").place(x=480, y=180)
    java_path_entry = CTk.CTkEntry(settings_window, width=250)
    java_path_entry.place(x=480, y=210)
    java_path_entry.insert(0, custom_java_path if custom_java_path else "")

    def select_java_path():
        java_path = filedialog.askopenfilename(
            title="Выберите исполняемый файл Java",
            filetypes=[("Java Executable", "java.exe javaw.exe")]
        )
        if java_path:
            java_path_entry.delete(0, CTk.END)
            java_path_entry.insert(0, java_path)

    CTk.CTkButton(settings_window, text="Выбрать Java", command=select_java_path).place(x=740, y=210)

    def save_settings_and_close():
        global custom_resolution_width, custom_resolution_height, custom_java_path
        custom_resolution_width = resolution_width_entry.get()
        custom_resolution_height = resolution_height_entry.get()
        custom_java_path = java_path_entry.get()
        save_settings()
        settings_window.destroy()
        app.deiconify()

    save_button = CTk.CTkButton(settings_window, text="Сохранить", command=save_settings_and_close)
    save_button.place(x=480, y=250)
    
settings_button = CTk.CTkButton(master=settings_frame, text="⚙️", command=open_settings_window, width=30, height=30)
settings_button.place(x=345, y=10)
settings_button.configure(state="normal")
    
CTk.CTkLabel(settings_frame, text="Выберите модлоадер:").place(x=10, y=120)

loader_combobox = CTk.CTkComboBox(settings_frame, values=["Vanilla", "Forge", "Fabric", "Quilt", "Clients"], command=update_loader, state='readonly')
loader_combobox.place(x=10, y=150)
loader_combobox.set(selected_loader)
hide_console_var = CTk.BooleanVar(value=True)


def load_settings_from_file():
    global selected_ram, selected_loader, custom_minecraft_directory
    if os.path.exists(settings_file):
        with open(settings_file, "r") as file:
            settings = json.load(file)
            selected_ram = settings.get("ram", max_ram // 2)
            selected_loader = settings.get("loader", "Vanilla")
            custom_minecraft_directory.set(settings.get("custom_minecraft_directory", os.path.join(os.path.expanduser("~"), ".minecraft")))

def disable_selection(event):
    return "break"

newsTextbox.bind("<ButtonPress>", disable_selection)
newsTextbox.bind("<KeyPress>", disable_selection)
newsTextbox.configure(state="disabled")

def disable_selection(event):
    return "break"

newsTextbox.bind("<ButtonPress>", disable_selection)
newsTextbox.bind("<KeyPress>", disable_selection)
newsTextbox.configure(state="disabled")

warning_label = CTk.CTkLabel(app, text="", text_color="red")
warning_label.place(x=5, y=435)
version_combobox = CTk.CTkComboBox(master=app, values=[], variable=versions_combobox_startvar)
version_combobox.place(x=540, y=450)
NickName = CTk.CTkEntry(master=app, placeholder_text="Username")
NickName.place(x=690, y=450)
play_button = CTk.CTkButton(master=app, text="Играть", command=launch_game, width=70)
play_button.place(x=835, y=450)

account_manager_button = CTk.CTkButton(
    master=settings_frame, text="👤", command=open_account_manager, width=30, height=30
)
account_manager_button.place(x=420, y=10)

icon = pystray.Icon("Xneon Launcher")
icon.icon = Image.open(icon_path)
icon.title = "Xneon Launcher"

menu = pystray.Menu(
    pystray.MenuItem("Показать", lambda: app.deiconify(), default=True), 
    pystray.MenuItem("Выход", lambda: (icon.stop(), app.quit()))
)

icon.menu = menu

def run_tray():
    icon.run()

tray_thread = threading.Thread(target=run_tray, daemon=True)
tray_thread.start()

def open_directory_selection_dialog():
    dialog = CTk.CTkToplevel(app)
    dialog.title("Кастомный путь")
    dialog.geometry("300x200")
    dialog.resizable(False, False)
    current_path_label = CTk.CTkLabel(dialog, text="", wraplength=250)
    current_path_label.pack(pady=10)

    def select_directory():
        directory = filedialog.askdirectory()
        if directory:
            custom_minecraft_directory.set(directory)
            current_path_label.configure(text=directory)

    def save_directory():
        save_settings()
        dialog.destroy()

    CTk.CTkButton(dialog, text="Выбрать путь", command=select_directory).pack(pady=10)
    CTk.CTkButton(dialog, text="Сохранить", command=save_directory).pack(pady=10)

    current_path_label.configure(text=custom_minecraft_directory.get())
    

def close_app():
    app.withdraw()

app.protocol("WM_DELETE_WINDOW", close_app)

def disable_controls():
    version_combobox.configure(state="disabled")
    loader_combobox.configure(state="disabled")
    play_button.configure(state="disabled")
    progress_bar.place(x=5, y=430)
    stop_button.place(x=395, y=430)

def enable_controls():
    version_combobox.configure(state="normal")
    loader_combobox.configure(state="normal")
    play_button.configure(state="normal")
    progress_bar.place_forget()
    stop_button.place_forget()

def run_application():
    load_settings()
    load_versions()
    accounts = load_accounts()
    check_internet_connection()
    setup_discord_rpc()
    app.mainloop()

if __name__ == "__main__":
    run_application()
