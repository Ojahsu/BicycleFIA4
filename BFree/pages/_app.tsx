// SPDX-FileCopyrightText: Olli Vanhoja <olli.vanhoja@gmail.com>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { ThemeProvider, createTheme } from '@mui/material/styles';
import 'styles/globals.css';
import CssBaseline from '@mui/material/CssBaseline';
import { red } from '@mui/material/colors';
import PropTypes from 'prop-types';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { useEffect } from 'react';
import { connectMQTT, disconnectMQTT } from 'lib/mqtt';
//import mqtt from 'mqtt';

export const cache = createCache({
	key: 'css',
	prepend: true,
});

// Create a theme instance.
const theme = createTheme({
	palette: {
		background: {
			default: '#fafafa',
		},
		primary: {
			main: '#1976D2',
		},
		secondary: {
			main: red.A400,
		},
		error: {
			main: red.A400,
		},
	},
});

function App({ Component, pageProps }) {
	useEffect(() => {
		// Remove the server-side injected CSS.
		const jssStyles = document.querySelector('#jss-server-side');
		if (jssStyles) {
			jssStyles.parentElement.removeChild(jssStyles);
		}

		// Initialiser MQTT au démarrage
		// Recommandé pour EMQX : wss://broker.emqx.io:8084/mqtt
		//const brokerUrl = localStorage.getItem('mqttBrokerUrl') || 'ws://broker.emqx.io:8083/mqtt';
		const brokerUrl = localStorage.getItem('mqttBrokerUrl') || 'ws://Joseph1:9001/mqtt';
		connectMQTT(brokerUrl).catch((err) => console.error('Failed to connect to MQTT:', err));

		return () => {
			disconnectMQTT();
		};
	}, []);

	return (
		<CacheProvider value={cache}>
			<ThemeProvider theme={theme}>
				{/* CssBaseline kickstart an elegant, consistent, and simple baseline to build upon. */}
				<CssBaseline />
				<Component {...pageProps} />
			</ThemeProvider>
		</CacheProvider>
	);
}

export default App;

App.propTypes = {
	Component: PropTypes.elementType.isRequired,
	emotionCache: PropTypes.object,
	pageProps: PropTypes.object.isRequired,
};
