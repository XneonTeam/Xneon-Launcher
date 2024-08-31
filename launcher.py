import requests
import os
from PyQt5.QtCore import QThread, pyqtSignal, QSize, Qt, QTimer
from PyQt5.QtWidgets import (QWidget, QHBoxLayout, QVBoxLayout, QLabel, QLineEdit, QComboBox, 
                             QSpacerItem, QSizePolicy, QProgressBar, QPushButton, QApplication, 
                             QMainWindow, QDialog, QTextEdit, QMessageBox, QCheckBox)
from PyQt5.QtGui import QPixmap
from minecraft_launcher_lib.utils import get_minecraft_directory, get_version_list
from minecraft_launcher_lib.install import install_minecraft_version
from minecraft_launcher_lib.command import get_minecraft_command
from random_username.generate import generate_username
from uuid import uuid1
from subprocess import call, CREATE_NO_WINDOW
from sys import argv, exit
import sys
from pypresence import Presence

def resource_path(relative_path):
    """ Получить абсолютный путь к ресурсу, работает как в режиме разработки, так и в PyInstaller """
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

def is_internet_connected():
    """ Проверить наличие подключения к интернету """
    try:
        response = requests.get('http://www.google.com', timeout=5)
        return True
    except requests.ConnectionError:
        return False

minecraft_directory = get_minecraft_directory().replace('minecraft', 'xneonlauncher')

class LaunchThread(QThread):
    launch_setup_signal = pyqtSignal(str, str, bool)
    progress_update_signal = pyqtSignal(int, int, str)
    state_update_signal = pyqtSignal(bool)

    version_id = ''
    username = ''
    show_console = True

    progress = 0
    progress_max = 0
    progress_label = ''

    def __init__(self):
        super().__init__()
        self.launch_setup_signal.connect(self.launch_setup)

    def launch_setup(self, version_id, username, show_console):
        self.version_id = version_id
        self.username = username
        self.show_console = show_console
    
    def update_progress_label(self, value):
        self.progress_label = value
        self.progress_update_signal.emit(self.progress, self.progress_max, self.progress_label)
    
    def update_progress(self, value):
        self.progress = value
        self.progress_update_signal.emit(self.progress, self.progress_max, self.progress_label)
    
    def update_progress_max(self, value):
        self.progress_max = value
        self.progress_update_signal.emit(self.progress, self.progress_max, self.progress_label)

    def run(self):
        self.state_update_signal.emit(True)

        install_minecraft_version(versionid=self.version_id, minecraft_directory=minecraft_directory, callback={
            'setStatus': self.update_progress_label,
            'setProgress': self.update_progress,
            'setMax': self.update_progress_max
        })

        if self.username == '':
            self.username = generate_username()[0]
        
        options = {
            'username': self.username,
            'uuid': str(uuid1()),
            'token': ''
        }

        creationflags = 0 if self.show_console else CREATE_NO_WINDOW
        call(get_minecraft_command(version=self.version_id, minecraft_directory=minecraft_directory, options=options), creationflags=creationflags)
        self.state_update_signal.emit(False)

class NewsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Новости")
        self.setFixedSize(400, 300)

        layout = QVBoxLayout()
        self.text_edit = QTextEdit()
        self.text_edit.setReadOnly(True)
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
        self.label = QLabel(
            "<b>Включите интернет и перезапустите лаунчер.</b>"
        )
        layout.addWidget(self.label)

        self.setLayout(layout)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Return or event.key() == Qt.Key_Enter:
            self.accept()

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        if not is_internet_connected():
            self.no_internet_dialog = NoInternetDialog(self)
            self.no_internet_dialog.exec_()
            exit()
        
        self.setFixedSize(300, 169)
        
        self.setWindowTitle("Xneon Launcher 1.0")
        
        self.centralwidget = QWidget(self)
        
        self.logo = QLabel(self.centralwidget)
        self.logo.setMaximumSize(QSize(256, 37))
        self.logo.setText('')
        self.logo.setPixmap(QPixmap(resource_path('assets\\title.png')))
        self.logo.setScaledContents(True)
        
        self.titlespacer = QSpacerItem(20, 40, QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Expanding)
        
        self.username = QLineEdit(self.centralwidget)
        self.username.setPlaceholderText('Имя пользователя')
        
        self.version_select = QComboBox(self.centralwidget)
        for version in get_version_list():
            self.version_select.addItem(version['id'])
        
        self.progress_spacer = QSpacerItem(20, 20, QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Minimum)
        
        self.start_progress_label = QLabel(self.centralwidget)
        self.start_progress_label.setText('')
        self.start_progress_label.setVisible(False)

        self.start_progress = QProgressBar(self.centralwidget)
        self.start_progress.setProperty('value', 24)
        self.start_progress.setVisible(False)
        
        self.start_button = QPushButton(self.centralwidget)
        self.start_button.setText('Играть')
        self.start_button.clicked.connect(self.launch_game)

        self.open_folder_button = QPushButton(self.centralwidget)
        self.open_folder_button.setText('Открыть папку лаунчера')
        self.open_folder_button.clicked.connect(self.open_minecraft_folder)
        
        self.vertical_layout = QVBoxLayout(self.centralwidget)
        self.vertical_layout.setContentsMargins(15, 15, 15, 15)
        self.vertical_layout.addWidget(self.logo, 0, Qt.AlignmentFlag.AlignHCenter)
        self.vertical_layout.addItem(self.titlespacer)
        self.vertical_layout.addWidget(self.username)
        self.vertical_layout.addWidget(self.version_select)
        self.vertical_layout.addItem(self.progress_spacer)
        self.vertical_layout.addWidget(self.start_progress_label)
        self.vertical_layout.addWidget(self.start_progress)
        
        self.horizontal_layout = QHBoxLayout()
        self.horizontal_layout.addWidget(self.start_button)
        self.horizontal_layout.addWidget(self.open_folder_button)
        
        self.vertical_layout.addLayout(self.horizontal_layout)

        self.launch_thread = LaunchThread()
        self.launch_thread.state_update_signal.connect(self.state_update)
        self.launch_thread.progress_update_signal.connect(self.update_progress)

        self.setCentralWidget(self.centralwidget)

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

        self.ensure_minecraft_folder_exists()

        self.load_username()

        self.load_last_version()

        self.load_console_checkbox_state()

        self.setup_discord_rpc()

        # Подключаем обновление Discord RPC при изменении выбранной версии
        self.version_select.currentIndexChanged.connect(self.update_discord_rpc)
    
    def state_update(self, value):
        self.start_button.setDisabled(value)
        self.start_progress_label.setVisible(value)
        self.start_progress.setVisible(value)
    
    def update_progress(self, value, maximum, label):
        self.start_progress.setMaximum(maximum)
        self.start_progress.setValue(value)
        self.start_progress_label.setText(label)
    
    def ensure_minecraft_folder_exists(self):
        if not os.path.exists(minecraft_directory):
            os.makedirs(minecraft_directory)

    def open_minecraft_folder(self):
        os.startfile(minecraft_directory)
    
    def launch_game(self):
        version_id = self.version_select.currentText()
        username = self.username.text()
        show_console = self.console_checkbox.isChecked()
        self.launch_thread.launch_setup(version_id, username, show_console)
        self.launch_thread.start()
    
    def show_news(self):
        self.news_dialog = NewsDialog(self)
        self.news_dialog.exec_()

    def load_username(self):
        if os.path.exists('username.txt'):
            with open('username.txt', 'r') as file:
                self.username.setText(file.read().strip())

    def save_username(self):
        with open('username.txt', 'w') as file:
            file.write(self.username.text().strip())
    
    def load_last_version(self):
        if os.path.exists('last_version.txt'):
            with open('last_version.txt', 'r') as file:
                version = file.read().strip()
                index = self.version_select.findText(version)
                if index >= 0:
                    self.version_select.setCurrentIndex(index)
    
    def save_last_version(self):
        with open('last_version.txt', 'w') as file:
            file.write(self.version_select.currentText().strip())
    
    def load_console_checkbox_state(self):
        if os.path.exists('console_checkbox_state.txt'):
            with open('console_checkbox_state.txt', 'r') as file:
                state = file.read().strip()
                self.console_checkbox.setChecked(state.lower() == 'true')
        else:
            self.console_checkbox.setChecked(True)    
    def save_console_checkbox_state(self):
        with open('console_checkbox_state.txt', 'w') as file:
            file.write('true' if self.console_checkbox.isChecked() else 'false')

    def setup_discord_rpc(self):
        CLIENT_ID = '1279183673660538972'  # Вставьте ваш client_id здесь
        icon_url = "https://i.imgur.com/1u1oHSS.png"  # URL вашей иконки
        launcher_website = "https://activator.xneon.fun"  # URL вашего сайта лаунчера
        try:
            self.discord_rpc = Presence(CLIENT_ID)
            self.discord_rpc.connect()

            # Получаем текущую выбранную версию Minecraft
            current_version = self.version_select.currentText()

            self.discord_rpc.update(
                state=f"Играет в Minecraft {current_version}",
                details="Запущен Xneon Launcher",
                large_image=icon_url,
                buttons=[{"label": "Сайт лаунчера", "url": launcher_website}]
            )
        except Exception as e:
            print(f"Ошибка при настройке Discord RPC: {e}")

    def update_discord_rpc(self):
        if hasattr(self, 'discord_rpc') and self.discord_rpc:
            try:
                current_version = self.version_select.currentText()
                self.discord_rpc.update(
                    state=f"Играет в Minecraft {current_version}",
                    details="Запущен Xneon Launcher",
                    large_image="https://i.imgur.com/1u1oHSS.png",
                    buttons=[{"label": "Сайт лаунчера", "url": "https://activator.xneon.fun"}]
                )
            except Exception as e:
                print(f"Ошибка при обновлении Discord RPC: {e}")

    def closeEvent(self, event):
        if self.discord_rpc:
            self.discord_rpc.close()
        self.save_username()
        self.save_last_version()
        self.save_console_checkbox_state()
        event.accept()

if __name__ == '__main__':
    app = QApplication(argv)
    window = MainWindow()
    window.show()
    exit(app.exec_())
