// SPDX-FileCopyrightText: Olli Vanhoja <olli.vanhoja@gmail.com>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import mqtt from 'mqtt';

let client: mqtt.MqttClient | null = null;

export function connectMQTT(brokerUrl: string): Promise<mqtt.MqttClient> {
	return new Promise((resolve, reject) => {
		client = mqtt.connect(brokerUrl, {
			reconnectPeriod: 1000,
		});

		client.on('connect', () => {
			console.log('Connected to MQTT broker');
			resolve(client!);
		});

		client.on('error', (error) => {
			console.error('MQTT connection error:', error);
			reject(error);
		});
	});
}

export function publishMessage(topic: string, message: string | number | object): void {
	if (!client || !client.connected) {
		console.warn('MQTT client not connected');
		return;
	}

	const payload = typeof message === 'object' ? JSON.stringify(message) : String(message);
	client.publish(topic, payload, { qos: 1 }, (err) => {
		if (err) {
			console.error(`Failed to publish to ${topic}:`, err);
		} else {
			console.log(`Published to ${topic}:`, payload);
		}
	});
}

export function disconnectMQTT(): void {
	if (client) {
		client.end();
		client = null;
	}
}

export function getClient(): mqtt.MqttClient | null {
	return client;
}
