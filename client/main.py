import time
from selenium.webdriver import Chrome
from selenium.webdriver.common.by import By


driver = Chrome()

driver.get("https://iu.webrtc-thesis.ru")
driver.implicitly_wait(5)
driver.find_element(by=By.ID)
time.sleep(10000)
