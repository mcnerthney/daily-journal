/**
 * React Native entry point for Daily Journal Mobile.
 *
 * Registration MUST happen here (not in App.jsx) so Metro can resolve the
 * root component correctly.
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
