'use strict';
/* eslint-disable jsdoc/check-tag-names */

class TimerManager {
    constructor(adapterInstance, i18nInstance) {
        this.adapter = adapterInstance;
        this.i18n = i18nInstance;
        this.nextTimerId = null;
        this.nextProcessTime = null;
        this.closed = false;
        this.timeouts = new Set();

        this._setTimeout(() => {
            this.adapter.setObjectNotExists('info.nextTimer', {
                type: 'state',
                common: {
                    name: this.i18n.nextTimer,
                    type: 'string',
                    role: 'info',
                    read: true,
                    write: false,
                },
                native: {},
            });
            this.calcNextProcess();
        }, 500);
    }

    _setTimeout(callback, delay) {
        const timeout = setTimeout(() => {
            this.timeouts.delete(timeout);
            if (!this.closed) {
                callback();
            }
        }, delay);
        this.timeouts.add(timeout);
        return timeout;
    }

    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.timeouts.forEach(timeout => clearTimeout(timeout));
        this.timeouts.clear();
    }

    check() {
        if (this.closed) {
            return;
        }
        //adapter.log.warn('Timer Check... this.nextProcessTime: '+ this.nextProcessTime + ' this.nextProcessTime: '+  this.nextProcessTime);
        if (this.nextProcessTime > 0 && this.nextProcessTime < new Date()) {
            const diff = new Date().getTime() - this.nextProcessTime.getTime();
            if (diff > 3600000) {
                this.adapter.log.warn('Timer is more than one hour overdue and was skipped');
                this.calcNextProcess();
            } else {
                this.adapter.log.debug('timer will trigger soon...');
                this.nextProcessTime = new Date(this.nextProcessTime.getTime() + 3600000);

                this._setTimeout(() => {
                    this.adapter.log.info(`start cleaning by timer ${this.nextTimerId}`);
                    this.adapter.setForeignState(
                        this.nextTimerId,
                        TimerManager.START,
                        false,
                        (err, obj) =>
                            // obj not exist anymore, so we need recalc, otherwise it would be triggered by stateChange
                            !obj && this.calcNextProcess(),
                    );
                }, this.adapter.config.pingInterval - diff);
            }
        }
    }

    // calculate the nexttime, when the timer (state) should running
    _calcNextProcessTime(timerObj, now, onlyCalc) {
        /** @type {Date | 0} */
        let nextProcessTime = timerObj.native.nextProcessTime ? new Date(timerObj.native.nextProcessTime) : 0;
        if (!nextProcessTime || nextProcessTime < now) {
            const terms = timerObj._id.split('.').pop().split('_');
            const minute = parseInt(terms[2], 10);
            const hour = parseInt(terms[1], 10);
            const day = terms[0].split('');
            if (!day.length) {
                nextProcessTime = 0;
            } else {
                nextProcessTime = new Date(now);
                nextProcessTime.setHours(hour, minute, 0, 0);
                if (hour < now.getHours() || (hour === now.getHours() && minute < now.getMinutes())) {
                    nextProcessTime.setDate(nextProcessTime.getDate() + 1);
                }
                const nowDay = nextProcessTime.getDay();
                let dayDiff = -99;
                for (let i = day.length - 1; i >= 0 && day[i] >= nowDay; i--) {
                    dayDiff = day[i] - nowDay;
                }
                if (dayDiff < 0) {
                    dayDiff = day[0] - nowDay + 7;
                }
                dayDiff && nextProcessTime.setDate(nextProcessTime.getDate() + dayDiff);
            }

            if (nextProcessTime && nextProcessTime != timerObj.native.nextProcessTime && !onlyCalc) {
                timerObj.native.nextProcessTime = nextProcessTime;
                timerObj.common.states['1'] =
                    `${this.i18n.weekDaysFull[nextProcessTime.getDay()]} ${this.adapter.formatDate(nextProcessTime, 'hh:mm')}`;
                let name = '';
                if (day.length > 0 || timerObj.native.channels) {
                    for (const d in day) {
                        name += `${this.i18n.weekDaysFull[day[d]].substr(0, 2)} `;
                    }
                } else {
                    name += `${this.i18n.weekDaysFull[day[0]]} `;
                }
                name += `${'0'.concat(hour.toString()).slice(-2)}:${'0'.concat(minute.toString()).slice(-2)}`;
                timerObj.common.name = name;

                if (timerObj.native.channels) {
                    name += ' >';
                    this.adapter.getChannelsOf('rooms', (err, roomObjs) => {
                        let channels = '';
                        for (const r in roomObjs) {
                            if (timerObj.native.channels.indexOf(roomObjs[r]._id.split('.').pop()) >= 0) {
                                channels += `,${roomObjs[r].common.name}`;
                            }
                        }
                        timerObj.common.name += ` >${channels.slice(1)}`;
                        this.adapter.setObject(timerObj._id, timerObj);
                    });
                } else {
                    this.adapter.setObject(timerObj._id, timerObj);
                }
                this.adapter.log.debug(
                    `calculate new process time (${timerObj.common.states['1']}) for timer ${timerObj._id}`,
                );
            }
        }
        return nextProcessTime;
    }

    calcNextProcess() {
        if (this.closed) {
            return;
        }
        const now = new Date(new Date().getTime() + 60000); //some time to calculate ...
        this.nextProcessTime = new Date(now.getTime() + 604800000); // we start latest 1 week later...
        this.nextTimerId = null;
        this.adapter.getStatesOf('timer', (err, timerObjects) => {
            if (this.closed) {
                return;
            }
            try {
                const timers = {};
                for (const t in timerObjects) {
                    timers[timerObjects[t]._id] = {
                        obj: timerObjects[t],
                        time: this._calcNextProcessTime(timerObjects[t], now),
                    };
                }

                this.adapter.getStates('timer.*', (err, timerStates) => {
                    if (this.closed) {
                        return;
                    }
                    for (const t in timerStates) {
                        if (timerStates[t] !== null && timerStates[t].val != TimerManager.DISABLED) {
                            if (timerStates[t].val == TimerManager.SKIP) {
                                timers[t].time = this._calcNextProcessTime(
                                    timers[t].obj,
                                    new Date(timers[t].time.setMinutes(1)),
                                    true,
                                );
                            }
                            if (timers[t].time < this.nextProcessTime) {
                                this.nextProcessTime = timers[t].time;
                                this.nextTimerId = t;
                            }
                        }
                    }
                    const nextTimerName =
                        this.nextTimerId && this.nextProcessTime
                            ? `${this.i18n.weekDaysFull[this.nextProcessTime.getDay()]} ${this.adapter.formatDate(
                                  this.nextProcessTime,
                                  'hh:mm',
                              )}`
                            : this.i18n.notAvailable;
                    const timerFolder = {
                        id: `${this.adapter.namespace}.timer`,
                        type: 'channel',
                        native: {},
                        common: { name: `${this.i18n.nextTimer}: ${nextTimerName}` },
                    };
                    this.nextProcessTime = new Date(this.nextProcessTime.getTime() - this.adapter.config.pingInterval);
                    this.adapter.setObject('timer', timerFolder);
                    this.adapter.setState('info.nextTimer', nextTimerName, true);
                    this.adapter.log.debug(`Next timer: ${nextTimerName}`);
                });
            } catch (error) {
                this.adapter.log.warn(`Could not calculate next timer ${error}`);
                if (this.adapter.supportsFeature && this.adapter.supportsFeature('PLUGINS')) {
                    const sentryInstance = this.adapter.getPluginInstance('sentry');
                    if (sentryInstance) {
                        sentryInstance.getSentryObject().captureException(error);
                    }
                }
            }
        });
    }
}

TimerManager.DISABLED = -1;
TimerManager.SKIP = 0;
TimerManager.ENABLED = 1;
TimerManager.START = 2;

module.exports = TimerManager;
