#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include <PubSubClient.h>
#include <WiFi.h>

// ========== RFID pins ==========
#define RST_PIN 9
#define SS_PIN 10
#define LED_VERT_PIN 3
#define LED_ROUGE_PIN 2
#define BUZZER_PIN 5

MFRC522 mfrc522(SS_PIN, RST_PIN);

// WiFi settings
// const char *ssid = "Chaton";
// const char *password = "Ratatouille";
const char *ssid = "RouterIotFIA4";
const char *password = "RouterIotFIA4!";

// MQTT Broker settings
const char *mqtt_broker = "192.168.0.214";
const char *mqtt_topic_mac = "homeTrainerCastres/Group1-C/MAC";
const char *mqtt_topic_rfid = "homeTrainerCastres/Group1-C/RFID";
const char *mqtt_tone = "homeTrainerCastres/Group1-C/TONE";
const int mqtt_port = 1883;
String client_id = "ArduinoClient-";
String MAC_address = "";

// Global variables
static unsigned long lastPublishTimeRFID = 0;
static unsigned long lastPublishTimeHeartbeat = 0;
static unsigned long lastRFIDCheck = 0;
static bool isRFIDConnected = false;

WiFiClient espClient;
PubSubClient mqtt_client(espClient);

// ========== Variables capteur cardiaque ==========
int rawValue;
const int delayMsec = 60;
static int beatMsec = 0;

// Prototypes
void connectToWiFi();
void connectToMQTTBroker();
void mqttCallback(char *topic, byte *payload, unsigned int length);
String getUID();
void printMacAddress();
bool heartbeatDetected(int IRSensorPin, int delay);
bool checkRFIDStatus();

void setup()
{
	Serial.begin(9600);

	// Initialisation des pins
	pinMode(LED_VERT_PIN, OUTPUT);
	pinMode(LED_ROUGE_PIN, OUTPUT);
	pinMode(BUZZER_PIN, OUTPUT);

	// WiFi et MQTT
	connectToWiFi();
	mqtt_client.setServer(mqtt_broker, mqtt_port);
	mqtt_client.setCallback(mqttCallback);
	connectToMQTTBroker();

	// RFID
	SPI.begin();
	delay(1000);
	mfrc522.PCD_Init();
	delay(1000);
	mfrc522.PCD_DumpVersionToSerial();
	delay(1000);
	Serial.println(F("Système prêt - RFID + Capteur cardiaque"));

	// Test LED
	digitalWrite(LED_VERT_PIN, HIGH);
	delay(1000);
	digitalWrite(LED_VERT_PIN, LOW);
	digitalWrite(LED_ROUGE_PIN, HIGH);

	// Bips de test
	for (int i = 0; i < 2; i++)
	{
		tone(BUZZER_PIN, 500, 100);
		delay(200);
	}
}

void printMacAddress()
{
	byte mac[6];
	Serial.print("MAC Address: ");
	WiFi.macAddress(mac);
	for (int i = 0; i < 6; i++)
	{
		MAC_address += String(mac[i], HEX);
		if (i < 5)
			MAC_address += ":";
		if (mac[i] < 16)
			client_id += "0";
		client_id += String(mac[i], HEX);
	}
	Serial.println(MAC_address);
}

void connectToWiFi()
{
	WiFi.begin(ssid, password);
	Serial.print("Connecting to WiFi");
	while (WiFi.status() != WL_CONNECTED)
	{
		delay(500);
		Serial.print(".");
	}
	delay(3000);
	printMacAddress();
	Serial.println("Connected to the WiFi network");
	Serial.print("Local ESP32 IP: ");
	Serial.println(WiFi.localIP());
}

void connectToMQTTBroker()
{
	while (!mqtt_client.connected())
	{
		Serial.print("Connecting to MQTT Broker as ");
		Serial.print(client_id.c_str());
		Serial.println(".....");
		if (mqtt_client.connect(client_id.c_str()))
		{
			Serial.println("Connected to MQTT broker");
			mqtt_client.subscribe(mqtt_topic_mac);
			mqtt_client.subscribe(mqtt_topic_rfid);
			mqtt_client.subscribe(mqtt_tone);
			String message = "Hello EMQX I'm " + MAC_address;
			mqtt_client.publish(mqtt_topic_mac, message.c_str());
		}
		else
		{
			Serial.print("Failed to connect to MQTT broker, rc=");
			Serial.print(mqtt_client.state());
			Serial.println(" try again in 5 seconds");
			delay(5000);
		}
	}
}

void mqttCallback(char *topic, byte *payload, unsigned int length)
{
	Serial.print("Message received on topic: ");
	Serial.println(topic);
	Serial.print("Message:");
	String messageTemp;
	for (int i = 0; i < length; i++)
	{
		messageTemp += (char)payload[i];
	}
	Serial.println(messageTemp);
	Serial.println("-----------------------");

	if (String(topic) == mqtt_tone)
	{
		if (messageTemp == "HIGH")
		{
			tone(BUZZER_PIN, 2000, 500);
		}
		else if (messageTemp == "LOW")
		{
			tone(BUZZER_PIN, 500, 500);
		}
	}
}

String getUID()
{
	String content = "";
	for (byte i = 0; i < mfrc522.uid.size; i++)
	{
		if (mfrc522.uid.uidByte[i] < 0x10)
			content += "0";
		content += String(mfrc522.uid.uidByte[i], HEX);
	}
	content.toUpperCase();
	return content;
}

bool checkRFIDStatus()
{
	byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
	if (version == 0x00 || version == 0xFF)
	{
		Serial.println(F("❌ [RFID] Capteur NON détecté"));
		isRFIDConnected = false;
		return true;
	}
	else
	{
		Serial.println(F("✅ [RFID] Capteur OK"));
		return false;
	}
}

// ========== Fonction de détection de battement cardiaque ==========
bool heartbeatDetected(int IRSensorPin, int delayTime)
{
	static int maxValue = 0;
	static bool isPeak = false;
	bool result = false;

	rawValue = analogRead(IRSensorPin);
	rawValue *= (1000 / delayTime);

	if (rawValue * 4L < maxValue)
	{
		maxValue = rawValue * 0.8;
	}
	if (rawValue > maxValue - (1000 / delayTime))
	{
		if (rawValue > maxValue)
		{
			maxValue = rawValue;
		}
		if (isPeak == false)
		{
			result = true;
		}
		isPeak = true;
	}
	else if (rawValue < maxValue - (3000 / delayTime))
	{
		isPeak = false;
		maxValue -= (1000 / delayTime);
	}
	return result;
}

void loop()
{
	// Vérifier connexion MQTT
	if (!mqtt_client.connected())
	{
		connectToMQTTBroker();
	}
	mqtt_client.loop();

	unsigned long currentTime = millis();

	// ========== MONITORING RFID (toutes les 10 secondes) ==========
	if (currentTime - lastRFIDCheck >= 10000)
	{
		if (checkRFIDStatus())
		{
			SPI.begin();
			delay(1000);
			mfrc522.PCD_Init();
			delay(1000);
			mfrc522.PCD_DumpVersionToSerial();
			delay(1000);
		}
		lastRFIDCheck = currentTime;
	}

	// ========== LECTURE RFID ==========
	if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial())
	{
		if (currentTime - lastPublishTimeRFID >= 1000)
		{
			String uidString = getUID();
			Serial.print("UID détecté: ");
			Serial.println(uidString);

			String message = "{\"uid\":\"" + uidString + "\",\"timestamp\":" + String(millis()) + "}";

			if (mqtt_client.publish(mqtt_topic_rfid, message.c_str()))
			{
				digitalWrite(LED_ROUGE_PIN, LOW);
				digitalWrite(LED_VERT_PIN, HIGH);
				tone(BUZZER_PIN, 2000, 150);
				delay(200);
				digitalWrite(LED_VERT_PIN, LOW);
			}
			else
			{
				Serial.println("❌ Échec de l'envoi de l'UID");
				for (int i = 0; i < 3; i++)
				{
					digitalWrite(LED_ROUGE_PIN, HIGH);
					tone(BUZZER_PIN, 500, 100);
					delay(100);
					digitalWrite(LED_ROUGE_PIN, LOW);
					delay(100);
				}
			}
			lastPublishTimeRFID = currentTime;
		}
		mfrc522.PICC_HaltA();
		mfrc522.PCD_StopCrypto1();
	}

	// Gestion LED rouge
	if (currentTime - lastPublishTimeRFID > 1500)
	{
		digitalWrite(LED_VERT_PIN, LOW);
		digitalWrite(LED_ROUGE_PIN, HIGH);
	}

	delay(delayMsec);
	beatMsec += delayMsec;
}