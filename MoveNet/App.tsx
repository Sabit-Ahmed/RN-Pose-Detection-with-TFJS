/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import React from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import {ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, TouchableHighlight, View} from 'react-native';
import AsyncStorage from "@react-native-community/async-storage";
import * as svgComponents from 'react-native-svg';

import * as Permissions from 'expo-permissions';
import {Camera} from 'expo-camera';
import {ExpoWebGLRenderingContext} from 'expo-gl';
import {cameraWithTensors} from '@tensorflow/tfjs-react-native';
import {poseSimilarity} from './posenet_utils';
import POSE_MAP from './exercise';
import * as poseNet from '@tensorflow-models/pose-detection';


const minThreshold = 0.15;
let setPositionCount = 0;
let poseIdeals: Array<object> = [];


const BACKEND_TO_USE = 'rn-webgl';

interface AppState {
    isTfReady: boolean;
    hasCameraPermission?: boolean;
    cameraType: any;
    isLoading: boolean;
    poseNetModel?: any;
    pose?: poseNet.Pose;
    skippedFrame: number,
    faceDetector?: any;
    modelName: string;
    poseIdeal?: any;
    currentIndex: any;
    totalPositionCount: number;
    isPosition: boolean;
    isFirstTime: boolean;
    posStates: Array<object>,
    exerciseName: string,
}

let squatCount = 0;
let model;
let modelType;
const inputTensorWidth = 152;
const inputTensorHeight = 200;

const AUTO_RENDER = true;
const MODEL_ARCHITECTURE = 'ResNet50'; // ResNet50

const TensorCamera = cameraWithTensors(Camera);

class App extends React.Component<{}, AppState> {
    rafID?: number;

    constructor(props: {}) {
        super(props);
        this.state = {
            isTfReady: false,
            isLoading: true,
            cameraType: Camera.Constants.Type.front,
            modelName: 'poseNet',
            skippedFrame: 0,
            currentIndex: 0,
            totalPositionCount: 0,
            isPosition: false,
            isFirstTime: true,
            posStates: POSE_MAP.states,
            exerciseName: 'test',
            poseNetModel: poseNet.SupportedModels.MoveNet,
        };
        this.handleImageTensorReady = this.handleImageTensorReady.bind(this);
    }

    async loadPoseNetModel() {
        model = poseNet.SupportedModels.MoveNet;
        modelType = poseNet.movenet.modelType.SINGLEPOSE_LIGHTNING;
        return await poseNet.createDetector(model, { modelType: modelType });
    }


    async handleImageTensorReady(
        images: IterableIterator<tf.Tensor3D>,
        updatePreview: () => void, gl: ExpoWebGLRenderingContext) {
        const loop = async () => {
            const {modelName} = this.state;
            if (!AUTO_RENDER) {
                updatePreview();
            }

            if (modelName === 'poseNet') {
                if (this.state.poseNetModel != null) {
                    if (this.state.isFirstTime) {
                        let pose;
                        const imageTensor = images.next().value;
                        const flipHorizontal = Platform.OS !== 'ios';
                        const poses = await this.state.poseNetModel.estimatePoses(imageTensor, {
                            maxPoses: 1, //When maxPoses = 1, a single pose is detected
                            flipHorizontal: flipHorizontal
                        });
                        pose = poses[0];
                        // console.log(pose.keypoints)
                        this.setState({pose});
                        tf.dispose([imageTensor]);
                        this.setState({
                            isFirstTime: false
                        })
                    }
                    if (this.state.skippedFrame > 0) {
                        let pose;
                        const imageTensor = images.next().value;
                        const flipHorizontal = Platform.OS !== 'ios';
                        const poses = await this.state.poseNetModel.estimatePoses(imageTensor, {
                            maxPoses: 1, //When maxPoses = 1, a single pose is detected
                            flipHorizontal: flipHorizontal
                        });
                        pose = poses[0];
                        this.setState({pose});
                        tf.dispose([imageTensor]);
                        this.setState({
                            skippedFrame: 0
                        })
                    } else {
                        this.setState({
                            skippedFrame: this.state.skippedFrame + 1
                        })
                    }


                    const cosineDistance = poseSimilarity(this.state.posStates[this.state.currentIndex], this.state.pose);
                    // console.log(cosineDistance, this.state.currentIndex)
                    if (cosineDistance < minThreshold) {
                        this.setState({
                            currentIndex: this.state.currentIndex + 1
                        })
                        if (this.state.currentIndex >= this.state.posStates.length) {
                            this.setState({
                                currentIndex: 0,
                            });
                            squatCount = squatCount + 1;
                        }
                    }
                }
            }

            if (!AUTO_RENDER) {
                gl.endFrameEXP();
            }
            this.rafID = requestAnimationFrame(loop);

        };
        await loop();
    }


    async componentWillUnmount() {
        if (this.rafID) {
            cancelAnimationFrame(this.rafID);
        }
        let jsonValue = JSON.stringify(poseIdeals)
        try {
            await AsyncStorage.setItem(this.state.exerciseName, jsonValue)
        } catch (e) {
            console.log(e)
        }
        poseIdeals = [];
    }

    async componentDidMount() {
        poseIdeals = [];
        await tf.setBackend(BACKEND_TO_USE);
        await tf.ready();
        const {status} = await Permissions.askAsync(Permissions.CAMERA);
        const [poseNetModel] = await Promise.all([this.loadPoseNetModel()]);
        this.setState({
            isTfReady: true,
            hasCameraPermission: status === 'granted',
            isLoading: false,
            poseNetModel,
        });
    }


    clearSquatCount() {
        squatCount = 0;
        setPositionCount = 0;
        this.setState({
            isPosition: false,
            totalPositionCount: 0,
            currentIndex: 0,
        })
    }

    switchCamera() {
        let type;

        if (this.state.cameraType === Camera.Constants.Type.front) {
            type = Camera.Constants.Type.back;
        } else {
            type = Camera.Constants.Type.front;
        }
        this.setState({cameraType: type});
    }


    renderPose() {
        const MIN_KEYPOINT_SCORE = 0.2;
        const {pose} = this.state;
        // console.log(pose)
        if (pose != null) {
            // console.log(this.state.isFirstTime)
            // console.log(pose)
            const keypoints = pose?.keypoints
                .filter(k => k?.score > MIN_KEYPOINT_SCORE)
                .map((k, i) => {
                    // console.log(k.position);
                    return <svgComponents.Circle
                        key={`skeletonkp_${i}`}
                        cx={k.x}
                        cy={k.y}
                        r='2'
                        strokeWidth='0'
                        fill='blue'
                    />;
                });


            const adjacentKeyPoints = poseNet.util.getAdjacentPairs(model);
            const skeleton = adjacentKeyPoints?.map(([i, j]) => {
                const kp1 = pose.keypoints[i];
                const kp2 = pose.keypoints[j]; // If score is null, just show the keypoint.
                const score1 = kp1?.score != null ? kp1?.score : 1;
                const score2 = kp2?.score != null ? kp2?.score : 1;
                const scoreThreshold = MIN_KEYPOINT_SCORE || 0;
    
                if (score1 >= scoreThreshold && score2 >= scoreThreshold) {
                    return <svgComponents.Line
                        key={`skeletonls_${i}${j}`}
                        x1={kp1.x}
                        y1={kp1.y}
                        x2={kp2.x}
                        y2={kp2.y}
                        stroke='white'
                        strokeWidth='2'
                    />;
                }
            });


            return <svgComponents.Svg height='100%' width='100%' scaleX={-1} scaleY={1}
                                      viewBox={`0 0 ${inputTensorWidth} ${inputTensorHeight}`}>
                {skeleton}
                {keypoints}
                <svgComponents.Text
                    stroke="white"
                    fill="white"
                    fontSize="30"
                    fontWeight="bold"
                    x="80"
                    y="30"
                    textAnchor="middle"
                >
                    {squatCount}
                </svgComponents.Text>


            </svgComponents.Svg>;
        } else {
            return null;
        }
    }


    render() {
        const {isLoading, modelName} = this.state;

        // TODO File issue to be able get this from expo.
        // Caller will still need to account for orientation/phone rotation changes
        let textureDims: { width: number; height: number; };
        if (Platform.OS === 'ios') {
            textureDims = {
                height: 1920,
                width: 1080,
            };
        } else {
            textureDims = {
                height: 1200,
                width: 1600,
            };
        }

        const camView = <View style={styles.cameraContainer}>
            <View style={styles.cameraInnerContainer}>
                <TensorCamera
                    // Standard Camera props
                    style={styles.camera}
                    type={this.state.cameraType}
                    zoom={0}
                    ratio={'4:3'}
                    // tensor related props
                    cameraTextureHeight={textureDims.height}
                    cameraTextureWidth={textureDims.width}
                    resizeHeight={inputTensorHeight}
                    resizeWidth={inputTensorWidth}
                    resizeDepth={3}
                    onReady={this.handleImageTensorReady}
                    autorender={AUTO_RENDER}
                />
                <View style={styles.modelResults}>
                    {modelName === 'poseNet' ? this.renderPose() : null}
                </View>
            </View>

            <TouchableHighlight
                style={styles.flipCameraBtn}
                onPress={() => {
                    this.switchCamera();
                }}
                underlayColor='#FFDE03'>
                <Text style={styles.textStyle}>
                    FLIP CAMERA
                </Text>

            </TouchableHighlight>
            <TouchableHighlight
                style={styles.resetBtn}
                onPress={() => {
                    this.clearSquatCount();
                }}
                underlayColor='#FFDE03'>
                <Text style={styles.textStyle}>
                    RESTART
                </Text>

            </TouchableHighlight>
        </View>;

        return (
            <SafeAreaView style={styles.body}>

                {
                    isLoading ?
                        <View style={styles.loadingIndicator}>
                            <ActivityIndicator size='large' color='#FF0266'/>
                        </View>
                        :
                        camView
                }

            </SafeAreaView>
        );
    }
}

const styles = StyleSheet.create({
    body: {
        backgroundColor: 'white',
        width: '100%',
        height: '100%'
    },
    logoStyle: {
        alignItems: 'center',
        marginTop: 50,
        zIndex: 1
    },
    loadingIndicator: {
        position: 'relative',
        marginTop: 150,
        alignItems: 'center',
        zIndex: 200
    },
    cameraContainer: {
        position: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#fff',
    },

    cameraInnerContainer: {
        position: 'relative',
        flex: 1,
        width: '100%',
    },
    camera: {
        // position: 'absolute',
        left: 45,
        top: 40,
        width: 300,
        height: 400,
        // zIndex: 1,
        borderWidth: 1,
        borderColor: 'red',
        // borderRadius: 0,
    },
    modelResults: {
        position: 'absolute',
        left: 45,
        top: 40,
        width: 300,
        height: 400,
        zIndex: 20000,
        borderWidth: 1,
        borderColor: 'black',
        borderRadius: 0,
    },
    textStyle: {
        fontSize: 16,
        color: 'white',
    },
    flipCameraBtn: {
        backgroundColor: '#424242',
        width: '98%',
        marginHorizontal: '1%',
        padding: 10,
        justifyContent: 'center',

        alignItems: 'center',
        borderColor: 'blue'
    },
    resetBtn: {
        backgroundColor: '#424242',
        width: '98%',
        marginHorizontal: '1%',
        padding: 10,
        justifyContent: 'center',

        alignItems: 'center',
        borderColor: 'blue'
    },
    idealFrameBtn: {
        backgroundColor: '#424242',
        width: '98%',
        marginHorizontal: '1%',
        padding: 10,
        marginVertical: 10,
        justifyContent: 'center',
        alignItems: 'center',
        borderColor: 'blue'
    },

});

export default App