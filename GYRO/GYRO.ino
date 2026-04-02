#include <WiFi.h>
#include <PubSubClient.h>
#include "MPU6050.h"
#include "Wire.h"
#include "DFRobot_BloodOxygen_S.h"

// ======================================================
// -------- LED STATUT ----------------------------------
// ======================================================
// États possibles du système
enum SystemState {
  STATE_CONNECTING,   // En cours de connexion (LED clignote vite)
  STATE_WIFI_OK,      // WiFi connecté, MQTT en attente (LED clignote lentement)
  STATE_ALL_OK,       // Tout connecté (LED fixe allumée)
  STATE_ERROR         // Erreur capteur (LED éteinte)
};

SystemState currentState = STATE_CONNECTING;

// Timing clignotement LED
unsigned long lastBlinkTime  = 0;
bool          ledState        = false;

// ======================================================
// -------- WIFI ----------------------------------------
// ======================================================
const char *ssid     = "RouterIotFIA4";
const char *password = "RouterIotFIA4!";

// ======================================================
// -------- MQTT ----------------------------------------
// ======================================================
const char *mqtt_broker    = "192.168.0.214";
const char *mqtt_direction = "CamLucieJoshua/direction";
const char *mqtt_heartbeat = "homeTrainerCastres/Group1-B/Heartbeat";
const int   mqtt_port      = 1883;

WiFiClient   espClient;
PubSubClient client(espClient);

// ======================================================
// -------- MAX30102 (Capteur cardiaque) ----------------
// ======================================================
#define I2C_ADDRESS 0x57
DFRobot_BloodOxygen_S_I2C MAX30102(&Wire, I2C_ADDRESS);

bool max30102Ready = false;

// Timing publication heartbeat
unsigned long lastHeartbeatPublish  = 0;
const unsigned long heartbeatInterval = 2000;

// ======================================================
// -------- MPU6050 (Gyroscope) -------------------------
// ======================================================
MPU6050 accelGyro;
int16_t ax, ay, az;
int16_t gx, gy, gz;

bool mpu6050Ready = false;

// -------- ANGLE ----------
float angle = 0;
unsigned long lastTime = 0;

// Anti drift
float driftCorrection = 0.999;

// ======================================================
// -------- TIMING GENERAL ------------------------------
// ======================================================
unsigned long lastSend = 0;
const int interval = 200;

// ======================================================
// -------- BOUTON RESET --------------------------------
// ======================================================
#define BUTTON_PIN 2

// ======================================================
// -------- GESTION LED ---------------------------------
// ======================================================

const int LED_BLEU = A1;
const int LED_JAUNE = A2;
const int LED_ROUGE = A3;

void updateLED() {
  unsigned long now = millis();

  switch (currentState) {

    // Clignotement rapide (200ms) : connexion en cours
    case STATE_CONNECTING:
      if (now - lastBlinkTime >= 200) {
        lastBlinkTime = now;
        ledState = !ledState;
        digitalWrite(LED_BUILTIN, ledState);
      }
      break;

    // Clignotement lent (800ms) : WiFi OK mais MQTT absent
    case STATE_WIFI_OK:
      if (now - lastBlinkTime >= 800) {
        lastBlinkTime = now;
        ledState = !ledState;
        digitalWrite(LED_BUILTIN, ledState);
      }
      break;

    // LED fixe allumée : tout est connecté
    case STATE_ALL_OK:
      digitalWrite(LED_BUILTIN, HIGH);
      break;

    // LED éteinte : erreur
    case STATE_ERROR:
      digitalWrite(LED_BUILTIN, LOW);
      break;
  }
}

// ======================================================
// -------- MISE A JOUR ETAT SYSTEME --------------------
// ======================================================
void updateSystemState() {
  bool wifiOk  = (WiFi.status() == WL_CONNECTED);
  bool mqttOk  = client.connected();
  bool sensorsOk = (mpu6050Ready && max30102Ready);

  if (!wifiOk) {
    currentState = STATE_CONNECTING;
  } else if (!mqttOk) {
    currentState = STATE_WIFI_OK;
  } else if (wifiOk && mqttOk && sensorsOk) {
    currentState = STATE_ALL_OK;
  } else {
    // WiFi + MQTT OK mais un capteur manque
    currentState = STATE_ERROR;
  }
}

// ======================================================
// -------- WIFI SETUP ----------------------------------
// ======================================================
void setup_wifi() {
  Serial.print("Connexion WiFi");
  currentState = STATE_CONNECTING;

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    updateLED(); // Clignote pendant la connexion
  }

  Serial.println("\nWiFi connecté - IP : " + WiFi.localIP().toString());
  currentState = STATE_WIFI_OK;
}

// ======================================================
// -------- MQTT RECONNECT ------------------------------
// ======================================================
void reconnect() {
  while (!client.connected()) {
    currentState = STATE_WIFI_OK; // MQTT perdu
    updateLED();

    Serial.print("Connexion MQTT...");
    if (client.connect("ESP32_GyroHeart")) {
      Serial.println("connecté !");
      updateSystemState(); // Réévalue l'état global
    } else {
      Serial.print("Échec, rc=");
      Serial.print(client.state());
      Serial.println(" - Nouvelle tentative dans 2s");
      delay(2000);
    }
  }
}

// ======================================================
// -------- SETUP ---------------------------------------
// ======================================================
void setup() {
  Serial.begin(9600);

  // LED
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  // WiFi + MQTT
  setup_wifi();
  client.setServer(mqtt_broker, mqtt_port);

  // I2C
  Wire.begin();

  // -------- MPU6050 ----------
  accelGyro.initialize();
  if (accelGyro.testConnection()) {
    Serial.println("MPU6050 OK");
    mpu6050Ready = true;
  } else {
    Serial.println("MPU6050 ERREUR !");
    mpu6050Ready = false;
  }

  // -------- MAX30102 ----------
  Serial.print("Initialisation MAX30102");
  int maxRetry = 5; // On n'attend pas indéfiniment
  while (!MAX30102.begin() && maxRetry > 0) {
    Serial.print(".");
    delay(1000);
    maxRetry--;
  }

  if (maxRetry > 0) {
    Serial.println("\nMAX30102 OK");
    MAX30102.sensorStartCollect();
    max30102Ready = true;
  } else {
    Serial.println("\nMAX30102 ERREUR !");
    max30102Ready = false;
  }

  // -------- Bouton reset ----------
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(LED_BLEU, OUTPUT);
  pinMode(LED_JAUNE, OUTPUT);
  pinMode(LED_ROUGE, OUTPUT);

  digitalWrite(LED_BLEU, LOW);
  digitalWrite(LED_JAUNE, LOW);
  digitalWrite(LED_ROUGE, LOW);

  lastTime = millis();

  // Première évaluation de l'état
  updateSystemState();

  Serial.println("=== Système prêt ===");
  Serial.print("État initial : ");
  Serial.println(currentState == STATE_ALL_OK ? "TOUT OK ✓" : "Partiel");
}

// ======================================================
// -------- LOOP ----------------------------------------
// ======================================================
void loop() {

  // Maintenir la connexion MQTT
  if (!client.connected()) reconnect();
  client.loop();

  // Mise à jour LED en continu
  updateSystemState();
  updateLED();

  unsigned long now = millis();

  // ====================================================
  // -------- CALCUL ANGLE (gyro Z) --------------------
  // ====================================================
  float dt = (now - lastTime) / 1000.0;
  lastTime = now;

  if (mpu6050Ready) {
    accelGyro.getRotation(&gx, &gy, &gz);
    float gyroZ = gx / 131.0;
    angle += gyroZ * dt;
    angle *= driftCorrection;
  }

  // ====================================================
  // -------- ENVOI ANGLE (toutes les 200ms) -----------
  // ====================================================
  if (now - lastSend >= interval) {
    lastSend = now;

    if (mpu6050Ready) {
      int finalAngle = constrain((int)angle, -45, 45);
      String payloadAngle = String(finalAngle);
      client.publish(mqtt_direction, payloadAngle.c_str());
      Serial.println("GYRO -> MQTT : " + payloadAngle + "°");
    }
  }

  // ====================================================
  // -------- BOUTON RESET ANGLE -----------------------
  // ====================================================
  if (digitalRead(BUTTON_PIN) == LOW) {
    angle = 0;
    Serial.println(">>> RESET ANGLE <<<");
    delay(200);
  }

  // ====================================================
  // -------- ENVOI HEARTBEAT (toutes les 2s) ----------
  // ====================================================
  if (now - lastHeartbeatPublish >= heartbeatInterval) {
    lastHeartbeatPublish = now;

    if (max30102Ready) {
      MAX30102.getHeartbeatSPO2();
      
      lastTime = millis();
      
      int heartbeat = MAX30102._sHeartbeatSPO2.Heartbeat;
      String payloadHeart = String(heartbeat);
      client.publish(mqtt_heartbeat, payloadHeart.c_str());
      Serial.println("HEART -> MQTT : " + payloadHeart + " bpm");

      // Gestion LEDs
      if (heartbeat >= 45 && heartbeat <= 85) {
        digitalWrite(LED_BLEU, HIGH);
        digitalWrite(LED_JAUNE, LOW);
        digitalWrite(LED_ROUGE, LOW);
      } else if (heartbeat > 85 && heartbeat <= 120) {
        digitalWrite(LED_BLEU, LOW);
        digitalWrite(LED_JAUNE, HIGH);
        digitalWrite(LED_ROUGE, LOW);
      } else if (heartbeat > 120) {
        digitalWrite(LED_BLEU, LOW);
        digitalWrite(LED_JAUNE, LOW);
        digitalWrite(LED_ROUGE, HIGH);
      } else {
        // heartbeat < 45 ou invalide
        digitalWrite(LED_BLEU, LOW);
        digitalWrite(LED_JAUNE, LOW);
        digitalWrite(LED_ROUGE, LOW);
      }
    }
  }
}
