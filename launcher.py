import os
import sys
import requests
from uuid import uuid1
from subprocess import call, CREATE_NO_WINDOW
from PyQt5.QtCore import QThread, pyqtSignal, QSize, Qt, QTimer
from PyQt5.QtWidgets import (
    QWidget, QHBoxLayout, QVBoxLayout, QLabel, QLineEdit, QComboBox,
    QProgressBar, QPushButton, QApplication, QMainWindow, QDialog, QTextEdit, QCheckBox
)
from PyQt5.QtGui import QPixmap
from minecraft_launcher_lib.utils import get_minecraft_directory, get_version_list
from minecraft_launcher_lib.install import install_minecraft_version
from minecraft_launcher_lib.command import get_minecraft_command
from minecraft_launcher_lib.fabric import install_fabric
from minecraft_launcher_lib.forge import install_forge_version
from random_username.generate import generate_username
from pypresence import Presence

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def is_internet_connected():
    try:
        requests.get('http://www.google.com', timeout=5)
        return True
    except requests.ConnectionError:
        return False

minecraft_directory = get_minecraft_directory().replace('minecraft', 'xneonlauncher')

def get_forge_id(version):
    url = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
    try:
        response = requests.get(url)
        promotions = response.json().get('promos', {})
        recommended_key = f"{version}-recommended"
        latest_key = f"{version}-latest"

        forge_id = promotions.get(recommended_key) or promotions.get(latest_key)
        if forge_id:
            return f"{version}-{forge_id}"
    except requests.RequestException as e:
        print(f"Ошибка при получении Forge ID: {e}")
    return None

class LaunchThread(QThread):
    launch_setup_signal = pyqtSignal(str, str, bool)
    progress_update_signal = pyqtSignal(int, int, str)
    state_update_signal = pyqtSignal(bool)
    finished_signal = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.launch_setup_signal.connect(self.launch_setup)
        self.version_id = ''
        self.username = ''
        self.show_console = True

    def launch_setup(self, version_id, username, show_console):
        self.version_id = version_id
        self.username = username
        self.show_console = show_console

    def update_progress(self, value, maximum, label):
        self.progress_update_signal.emit(value, maximum, label)

    def run(self):
        self.state_update_signal.emit(True)
        install_minecraft_version(
            versionid=self.version_id,
            minecraft_directory=minecraft_directory,
            callback={
                'setStatus': lambda v: self.update_progress(0, 0, v),
                'setProgress': lambda v: self.update_progress(v, 0, ''),
                'setMax': lambda v: self.update_progress(0, v, '')
            }
        )
        if not self.username:
            self.username = generate_username()[0]
        options = {'username': self.username, 'uuid': str(uuid1()), 'token': ''}
        creationflags = 0 if self.show_console else CREATE_NO_WINDOW
        call(get_minecraft_command(version=self.version_id, minecraft_directory=minecraft_directory, options=options), creationflags=creationflags)
        self.state_update_signal.emit(False)
        self.finished_signal.emit()

class FabricInstallThread(QThread):
    install_complete_signal = pyqtSignal(bool, str)
    progress_update_signal = pyqtSignal(int, int, str)

    def __init__(self, version_id, minecraft_directory):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory

    def update_progress(self, value, maximum, label):
        self.progress_update_signal.emit(value, maximum, label)

    def run(self):
        fabric_version_id = f"fabric-loader-0.16.3-{self.version_id}"
        version_path = os.path.join(self.minecraft_directory, "versions", fabric_version_id)
        if os.path.exists(version_path):
            self.install_complete_signal.emit(True, fabric_version_id)
            return
        try:
            install_fabric(self.version_id, self.minecraft_directory, callback={
                'setStatus': lambda v: self.update_progress(0, 0, v),
                'setProgress': lambda v: self.update_progress(v, 0, ''),
                'setMax': lambda v: self.update_progress(0, v, '')
            })
            self.install_complete_signal.emit(True, fabric_version_id)
        except Exception as e:
            print(f"Ошибка при установке Fabric: {e}")
            self.install_complete_signal.emit(False, "")

class ForgeInstallThread(QThread):
    install_complete_signal = pyqtSignal(bool, str)
    progress_update_signal = pyqtSignal(int, int, str)

    def __init__(self, version_id, minecraft_directory):
        super().__init__()
        self.version_id = version_id
        self.minecraft_directory = minecraft_directory

    def update_progress(self, value, maximum, label):
        self.progress_update_signal.emit(value, maximum, label)

    def run(self):
        forge_id = get_forge_id(self.version_id)
        if forge_id is None:
            print("Не удалось получить Forge ID, установка отменена.")
            self.install_complete_signal.emit(False, "")
            return

        forge_version_path = os.path.join(self.minecraft_directory, "versions", forge_id)
        if os.path.exists(forge_version_path):
            print(f"Forge {forge_id} уже установлен.")
            self.install_complete_signal.emit(True, forge_id)
            return

        try:
            install_forge_version(
                forge_id,
                self.minecraft_directory,
                callback={
                    'setStatus': lambda v: self.update_progress(0, 0, v),
                    'setProgress': lambda v: self.update_progress(v, 0, ''),
                    'setMax': lambda v: self.update_progress(0, v, '')
                }
            )
            self.install_complete_signal.emit(True, forge_id)
        except Exception as e:
            print(f"Ошибка при установке Forge: {e}")
            self.install_complete_signal.emit(False, "")

class NewsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Новости")
        self.setFixedSize(400, 300)

        layout = QVBoxLayout()
        self.text_edit = QTextEdit(readOnly=True)
        layout.addWidget(self.text_edit)
        self.setLayout(layout)
        self.load_readme_content()

    def load_readme_content(self):
        url = "https://raw.githubusercontent.com/MAINER4IK/Xneon-Launcher/main/README.md"
        try:
            response = requests.get(url)
            if response.status_code == 200:
                self.text_edit.setMarkdown(response.text)
            else:
                self.text_edit.setText("Не удалось загрузить новостное содержание.")
        except requests.RequestException as e:
            self.text_edit.setText(f"Ошибка при загрузке новостей: {e}")

class NoInternetDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Нет подключения к интернету")
        self.setFixedSize(300, 50)

        layout = QVBoxLayout()
        self.label = QLabel("<b>Включите интернет и перезапустите лаунчер.</b>")
        layout.addWidget(self.label)
        self.setLayout(layout)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            self.accept()

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        if not is_internet_connected():
            self.no_internet_dialog = NoInternetDialog(self)
            self.no_internet_dialog.exec_()
            exit()

        self.setFixedSize(286, 180)
        self.setWindowTitle("Xneon Launcher 1.2")
        self.centralwidget = QWidget(self)
        self.setup_ui()
        self.launch_thread = LaunchThread()
        self.launch_thread.state_update_signal.connect(self.state_update)
        self.launch_thread.progress_update_signal.connect(self.update_progress)
        self.launch_thread.finished_signal.connect(self.on_game_finished)
        self.version_list = get_version_list()
        self.update_version_list()
        self.ensure_minecraft_folder_exists()
        self.load_settings()
        self.setup_discord_rpc()

    def setup_ui(self):
        self.logo = QLabel(self.centralwidget)
        self.logo.setMaximumSize(QSize(256, 37))
        self.logo.setPixmap(QPixmap(resource_path('assets\\title.png')))
        self.logo.setScaledContents(True)

        self.username = QLineEdit(self.centralwidget)
        self.username.setPlaceholderText('Имя пользователя')

        self.version_select = QComboBox(self.centralwidget)
        self.mod_loader_select = QComboBox(self.centralwidget)
        self.mod_loader_select.addItems(['Vanilla', 'Fabric', 'Forge'])
        self.mod_loader_select.currentIndexChanged.connect(self.update_version_list)

        self.start_progress_label = QLabel(self.centralwidget)
        self.start_progress_label.setVisible(False)
        self.start_progress = QProgressBar(self.centralwidget)
        self.start_progress.setVisible(False)

        self.start_button = QPushButton('Играть', self.centralwidget)
        self.start_button.clicked.connect(self.launch_game)

        self.open_folder_button = QPushButton('Открыть папку лаунчера', self.centralwidget)
        self.open_folder_button.clicked.connect(self.open_minecraft_folder)

        self.layout_ui()

    def layout_ui(self):
        vertical_layout = QVBoxLayout(self.centralwidget)
        vertical_layout.setContentsMargins(15, 15, 15, 15)
        vertical_layout.addWidget(self.logo, 0, Qt.AlignmentFlag.AlignHCenter)
        vertical_layout.addWidget(self.username)
        vertical_layout.addWidget(self.version_select)
        vertical_layout.addWidget(self.mod_loader_select)
        vertical_layout.addWidget(self.start_progress_label)
        vertical_layout.addWidget(self.start_progress)

        horizontal_layout = QHBoxLayout()
        horizontal_layout.addWidget(self.start_button)
        horizontal_layout.addWidget(self.open_folder_button)

        vertical_layout.addLayout(horizontal_layout)
        self.setCentralWidget(self.centralwidget)

        self.setup_title_bar()

    def setup_title_bar(self):
        self.title_bar_widget = QWidget(self)
        self.title_bar_layout = QHBoxLayout(self.title_bar_widget)
        self.title_bar_widget.setFixedHeight(30)
        self.title_bar_widget.move(0, 0)
        self.title_bar_widget.resize(self.width(), 30)

        self.news_button = QPushButton("?", self.title_bar_widget)
        self.news_button.setFixedSize(30, 22)
        self.news_button.setToolTip("Новости")
        self.news_button.clicked.connect(self.show_news)

        self.console_checkbox = QCheckBox("", self.title_bar_widget)
        self.console_checkbox.setToolTip("Показывать консоль при запуске Minecraft")

        self.title_bar_layout.addWidget(self.console_checkbox)
        self.title_bar_layout.addStretch()
        self.title_bar_layout.addWidget(self.news_button)
        self.title_bar_widget.raise_()

    def update_version_list(self):
        selected_loader = self.mod_loader_select.currentText()
        self.version_select.clear()
        fabric_supported_versions = [f'1.{i}' for i in range(14, 22)]

        versions = [
            f"{v['id']} (snapshot)" if v['type'] == 'snapshot' else v['id']
            for v in self.version_list if v['type'] in ['release', 'snapshot', 'old_alpha', 'old_beta']
            and (
                selected_loader == 'Vanilla' or
                (selected_loader == 'Fabric' and any(v['id'].startswith(ver) for ver in fabric_supported_versions)) or
                (selected_loader == 'Forge' and v['type'] == 'release' and self.is_forge_version_supported(v['id']))
            )
        ]

        self.version_select.addItems(versions or ["Нет доступных версий"])

    def is_forge_version_supported(self, version_id):
        major_minor_patch = version_id.split('.')
        if len(major_minor_patch) >= 2:
            major, minor = map(int, major_minor_patch[:2])
            patch = int(major_minor_patch[2]) if len(major_minor_patch) > 2 else 0
            # Убираем поддержку Forge для версий 1.13 и 1.13.1
            if major == 1 and minor == 13 and patch in (0, 1):
                return False
            return major > 1 or (major == 1 and (minor > 12 or (minor == 12 and patch >= 2)))
        return False

    def state_update(self, value):
        self.start_button.setDisabled(value)
        self.start_progress_label.setVisible(value)
        self.start_progress.setVisible(value)
        self.setFixedSize(300, 230 if value else 180)

    def update_progress(self, value, maximum, label):
        self.start_progress.setMaximum(maximum)
        self.start_progress.setValue(value)
        self.start_progress_label.setText(label)

    def ensure_minecraft_folder_exists(self):
        os.makedirs(minecraft_directory, exist_ok=True)

    def open_minecraft_folder(self):
        os.startfile(minecraft_directory)

    def launch_game(self):
        version_id = self.version_select.currentText().split(' ')[0]
        self.current_version_playing = version_id  # Track the version being launched
        username = self.username.text()
        show_console = self.console_checkbox.isChecked()
        mod_loader = self.mod_loader_select.currentText()

        if mod_loader == 'Fabric':
            self.fabric_install_thread = FabricInstallThread(version_id, minecraft_directory)
            self.fabric_install_thread.install_complete_signal.connect(self.on_fabric_install_complete)
            self.fabric_install_thread.progress_update_signal.connect(self.update_progress)
            self.state_update(True)
            self.fabric_install_thread.start()
        elif mod_loader == 'Forge':
            self.forge_install_thread = ForgeInstallThread(version_id, minecraft_directory)
            self.forge_install_thread.install_complete_signal.connect(self.on_forge_install_complete)
            self.forge_install_thread.progress_update_signal.connect(self.update_progress)
            self.state_update(True)
            self.forge_install_thread.start()
        else:
            self.launch_thread.launch_setup(version_id, username, show_console)
            self.launch_thread.start()

    def on_fabric_install_complete(self, success, fabric_version_id):
        if success:
            self.launch_thread.launch_setup(fabric_version_id, self.username.text(), self.console_checkbox.isChecked())
            self.launch_thread.start()
        else:
            print("Не удалось установить Fabric, запуск отменён.")
        self.state_update(False)

    def on_forge_install_complete(self, success, forge_version_id):
        if success:
            minecraft_version = self.version_select.currentText().split(' ')[0]
            forge_version = forge_version_id.split('-')[-1]
            minecraft_forge_version_id = f"{minecraft_version}-forge-{forge_version}"
            self.launch_thread.launch_setup(minecraft_forge_version_id, self.username.text(), self.console_checkbox.isChecked())
            self.launch_thread.start()
        else:
            print("Не удалось установить Forge, запуск отменён.")
        self.state_update(False)

    def on_game_finished(self):
        self.current_version_playing = None
        self.update_discord_rpc()

    def show_news(self):
        self.news_dialog = NewsDialog(self)
        self.news_dialog.exec_()

    def load_settings(self):
        settings = {
            '.mod_loader.txt': self.mod_loader_select,
            '.username.txt': self.username,
            '.last_version.txt': self.version_select
        }
        for filename, widget in settings.items():
            self.load_setting(filename, widget)
        self.load_console_checkbox_state()

    def save_settings(self):
        settings = {
            '.mod_loader.txt': self.mod_loader_select.currentText().strip(),
            '.username.txt': self.username.text().strip(),
            '.last_version.txt': self.version_select.currentText().strip()
        }
        for filename, value in settings.items():
            self.save_setting(filename, value)
        self.save_console_checkbox_state()

    def load_console_checkbox_state(self):
        state = self.load_setting('.console_checkbox_state.txt')
        self.console_checkbox.setChecked(state.lower() == 'true' if state else True)

    def save_console_checkbox_state(self):
        self.save_setting('.console_checkbox_state.txt', 'true' if self.console_checkbox.isChecked() else 'false')

    def load_setting(self, filename, widget=None):
        if os.path.exists(filename):
            with open(filename, 'r') as file:
                value = file.read().strip()
                if widget:
                    if isinstance(widget, QComboBox):
                        index = widget.findText(value)
                        if index >= 0:
                            widget.setCurrentIndex(index)
                    elif isinstance(widget, QLineEdit):
                        widget.setText(value)
                return value

    def save_setting(self, filename, value):
        with open(filename, 'w') as file:
            file.write(value)
        self.set_hidden_attribute(filename)

    def set_hidden_attribute(self, filename):
        if sys.platform == 'win32':
            import ctypes
            FILE_ATTRIBUTE_HIDDEN = 0x02
            ctypes.windll.kernel32.SetFileAttributesW(filename, FILE_ATTRIBUTE_HIDDEN)

    def setup_discord_rpc(self):
        CLIENT_ID = '1279183673660538972'
        try:
            self.discord_rpc = Presence(CLIENT_ID)
            self.discord_rpc.connect()
            self.rpc_timer = QTimer(self)
            self.rpc_timer.timeout.connect(self.update_discord_rpc)
            self.rpc_timer.start(30000)  # Update every 30 seconds
            self.update_discord_rpc()
        except Exception as e:
            print(f"Ошибка при настройке Discord RPC: {e}")

    def update_discord_rpc(self):
        if hasattr(self, 'discord_rpc') and self.discord_rpc:
            try:
                if hasattr(self, 'current_version_playing') and self.current_version_playing:
                    current_version = self.current_version_playing
                    mod_loader = self.mod_loader_select.currentText()

                    if mod_loader != 'Vanilla':
                        state_text = f"Играет в Minecraft {current_version} с {mod_loader}"
                        small_image_key = {
                            'Fabric': 'fabric_icon',
                            'Forge': 'forge_icon'
                        }.get(mod_loader)

                        mod_count = self.get_mod_count()
                        small_text = f"Установлено {mod_count} модов"
                    else:
                        state_text = f"Играет в Minecraft {current_version}"
                        small_image_key = None
                        small_text = None

                    self.discord_rpc.update(
                        state=state_text,
                        details="Запущен Xneon Launcher",
                        large_image="https://i.imgur.com/1u1oHSS.png",
                        small_image=small_image_key,
                        small_text=small_text,
                        buttons=[{"label": "Сайт лаунчера", "url": "https://activator.xneon.fun"}]
                    )
                else:
                    self.discord_rpc.update(
                        state="Ожидание запуска Minecraft",
                        details="Запущен Xneon Launcher",
                        large_image="https://i.imgur.com/1u1oHSS.png",
                        buttons=[{"label": "Сайт лаунчера", "url": "https://activator.xneon.fun"}]
                    )
            except Exception as e:
                print(f"Ошибка при обновлении Discord RPC: {e}")

    def get_mod_count(self):
        mods_directory = os.path.join(minecraft_directory, 'mods')
        if not os.path.exists(mods_directory):
            return 0
        mod_files = [f for f in os.listdir(mods_directory) if f.endswith('.jar')]
        return len(mod_files)

    def closeEvent(self, event):
        if hasattr(self, 'discord_rpc') and self.discord_rpc:
            self.discord_rpc.close()
        self.save_settings()
        event.accept()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())
