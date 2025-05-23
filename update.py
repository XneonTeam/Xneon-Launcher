import requests
import os
import subprocess
from CTkMessagebox import CTkMessagebox
import time
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

VERSION_FILE = "current_version.txt"

def read_current_version():
    if os.path.exists(VERSION_FILE):
        with open(VERSION_FILE, 'r') as file:
            return file.read().strip()
    return "1.9"

def write_current_version(version):
    with open(VERSION_FILE, 'w') as file:
        file.write(version)

def check_for_updates():
    current_version = read_current_version()
    url = "https://api.github.com/repos/MAINER4IK/Xneon-Launcher/releases/latest"
    response = requests.get(url)
    if response.status_code == 200:
        release = response.json()
        latest_version = release['tag_name']
        if latest_version != current_version:
            # Используем CTkMessagebox вместо tkinter.messagebox
            msg = CTkMessagebox(
                title="Доступно новое обновление!",
                message=f"Найдено обновление {latest_version}. Хотите обновить?",
                icon="question",
                option_1="Нет",
                option_2="Да"
            )
            response = msg.get()
            
            if response == "Да":
                update_launcher(release['assets'][0]['browser_download_url'], latest_version)
            else:
                print("Обновление отменено пользователем.")
                start_launcher()
        else:
            print("У вас последняя версия лаунчера.")
            start_launcher()
    else:
        print("Не удалось проверить наличие обновлений.")
        start_launcher()

def update_launcher(download_url, new_version):
    try:
        subprocess.run(['taskkill', '/F', '/IM', 'launcher.exe'], stderr=subprocess.DEVNULL)
        print("Попытка завершить процесс launcher.exe выполнена.")

        time.sleep(1)

        if os.path.exists("launcher.exe"):
            max_retries = 5
            for i in range(max_retries):
                try:
                    os.remove("launcher.exe")
                    print("Старый файл launcher.exe удален.")
                    break
                except Exception as e:
                    print(f"Ошибка при удалении файла (попытка {i + 1}): {e}")
                    time.sleep(1)
            else:
                print(f"Не удалось удалить файл launcher.exe после {max_retries} попыток.")
                return

        try:
            response = requests.get(download_url, stream=True, verify=False)
            response.raise_for_status()
            with open("launcher.exe", "wb") as file:
                for chunk in response.iter_content(chunk_size=8192):
                    file.write(chunk)
            print("Новый файл launcher.exe скачан.")
        except requests.exceptions.RequestException as e:
            print(f"Ошибка при скачивании файла: {e}")
            return

        write_current_version(new_version)
        print(f"Текущая версия обновлена до {new_version}.")

        start_launcher()
    except Exception as e:
        print(f"Ошибка при обновлении лаунчера: {e}")

def start_launcher():
    subprocess.Popen("launcher.exe")
    print("Лаунчер запущен.")

check_for_updates()
