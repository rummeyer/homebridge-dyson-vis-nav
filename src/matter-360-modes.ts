// Homebridge plugin for the Dyson 360 Vis Nav robot vacuum
// Copyright © 2026 Oliver Rummeyer
// Derived from matterbridge-dyson-robot, copyright © 2025-2026 Alexander Thoukydides

import { ModeBase, RvcCleanMode, RvcRunMode } from './matter-clusters.js';
import { assertIsDefined } from './utils.js';

// Robot Vacuum Cleaner Run Mode cluster modes
export enum RvcRunMode360 {
    Idle,
    Cleaning,
    Mapping
}

// Robot Vacuum Cleaner Clean Mode cluster modes
export enum RvcCleanMode360 {
    Quiet,      // Eye: Quiet  Heurist: Quiet  Vis Nav: Quiet
    Quick,      //                             Vis Nav: Quick
    High,       //             Heurist: High
    MaxBoost,   // Eye: Max    Heurist: Max    Vis Nav: Boost
    Auto        //                             Vis Nav: Auto
}

// Labels to use for each supported RVC Clean Mode
export type RvcCleanModeLabels = [RvcCleanMode360, string][];

export interface RvcCleanModeOptions {
    labels:         RvcCleanModeLabels;
    simpleModeTags: boolean;
}

// The RVC Run Mode cluster's supportedModes attribute
export const RVC_RUN_MODE_SUPPORTED: ModeBase.ModeOption[] = [{
    label:      'Idle',
    mode:       RvcRunMode360.Idle,
    modeTags:   [{ value: RvcRunMode.ModeTag.Idle }]
}, {
    label:      'Cleaning',
    mode:       RvcRunMode360.Cleaning,
    modeTags:   [{ value: RvcRunMode.ModeTag.Cleaning }]
}, {
    label:      'Mapping',
    mode:       RvcRunMode360.Mapping,
    modeTags:   [{ value: RvcRunMode.ModeTag.Mapping }]
}];

// Mode tags to use for each clean mode (only the first is used in simple mode)
const CLEAN_MODE_TAGS: Record<RvcCleanMode360, { value: RvcCleanMode.ModeTag }[]> = {
    [RvcCleanMode360.Quiet]: [
        { value: RvcCleanMode.ModeTag.Quiet },
        { value: RvcCleanMode.ModeTag.Vacuum },
        { value: RvcCleanMode.ModeTag.LowEnergy },
        { value: RvcCleanMode.ModeTag.LowNoise },
        { value: RvcCleanMode.ModeTag.Min },
        { value: RvcCleanMode.ModeTag.Night }
    ],
    [RvcCleanMode360.Quick]: [
        { value: RvcCleanMode.ModeTag.Quick },
        { value: RvcCleanMode.ModeTag.Vacuum },
        { value: RvcCleanMode.ModeTag.Day }
    ],
    [RvcCleanMode360.High]: [
        { value: RvcCleanMode.ModeTag.DeepClean },
        { value: RvcCleanMode.ModeTag.Vacuum },
        { value: RvcCleanMode.ModeTag.Day }
    ],
    [RvcCleanMode360.MaxBoost]: [
        { value: RvcCleanMode.ModeTag.Max },
        { value: RvcCleanMode.ModeTag.Vacuum },
        { value: RvcCleanMode.ModeTag.Day }
    ],
    [RvcCleanMode360.Auto]: [
        { value: RvcCleanMode.ModeTag.Auto },
        { value: RvcCleanMode.ModeTag.Vacuum },
        { value: RvcCleanMode.ModeTag.Day }
    ]
};

// Build the RVC Clean Mode cluster's supportedModes attribute.
//
// The Matter specification requires every RVC Clean Mode to carry a tag saying
// what the mode actually does, and matter.js refuses to start a cluster whose
// supported modes include neither `Vacuum` nor `Mop`. So `simpleModeTags` trims
// only the descriptive extras (Quiet, Night, LowEnergy, …); the `Vacuum` tag is
// always kept, since every device this plugin supports is a vacuum.
export function rvcCleanModeSupported(
    { labels, simpleModeTags }: RvcCleanModeOptions
): ModeBase.ModeOption[] {
    const modeTags = (mode: RvcCleanMode360): { value: RvcCleanMode.ModeTag }[] => {
        const tags = CLEAN_MODE_TAGS[mode];
        assertIsDefined(tags[0]);
        if (!simpleModeTags) return tags;
        const simple = [tags[0]];
        if (tags[0].value !== RvcCleanMode.ModeTag.Vacuum) {
            simple.push({ value: RvcCleanMode.ModeTag.Vacuum });
        }
        return simple;
    };
    return labels.map(([mode, label]) => ({ label, mode, modeTags: modeTags(mode) }));
}
