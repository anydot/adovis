$(document).ready(async function () {

    if (!Array.prototype.last) {
        Array.prototype.last = function () {
            return this[this.length - 1]
        }
    }

    if (!Array.prototype.append) {
        Array.prototype.append = function (item) {
            this[this.length] = item
        }
    }

    let storage = window.localStorage

    let viewMain = $('#view-main')
    let viewLoginAdo = $('#view-login-ado')
    let viewLoginTgl = $('#view-login-tgl')

    let emailAdo = storage.getItem('emailAdo')
    let credentialsAdo = storage.getItem('credentialsAdo')
    let credentialsTgl = storage.getItem('credentialsTgl')
    let workspaceId = '4639597'

    function loginAdo() {

        viewLoginAdo.hide()
        if (credentialsTgl) {
            viewMain.show()
            renderReport()
        } else {
            viewLoginTgl.show()
        }

        emailAdo = $('#email-ado').val()
        credentialsAdo = 'adovis:' + $('#input-pat-ado').val()
        $('#email-ado').val('')
        $('#input-pat-ado').val('')
        storage.setItem('emailAdo', emailAdo)
        storage.setItem('credentialsAdo', credentialsAdo)
    }

    function loginTgl() {

        viewLoginTgl.hide()
        viewMain.show()

        credentialsTgl = $('#input-pat-tgl').val() + ':api_token'
        $('#input-pat-tgl').val('')
        storage.setItem('credentialsTgl', credentialsTgl)

        renderReport()
    }

    function logout() {

        viewMain.hide()
        viewLoginTgl.hide()
        viewLoginAdo.show()

        emailAdo = null
        credentialsAdo = null
        credentialsTgl = null
        storage.removeItem('emailAdo')
        storage.removeItem('credentialsAdo')
        storage.removeItem('credentialsTgl')
        $('#email-ado').val('')
        $('#input-pat-ado').val('')
        $('#input-pat-tgl').val('')
    }

    $('#button-login-ado').click(loginAdo)
    $('#button-login-tgl').click(loginTgl)
    $('#button-logout').click(logout)
    $('#button-logout2').click(logout)

    $('#input-pat-ado').keypress(function (e) {
        if (e.which == 13) {
            loginAdo()
            return false
        }
    })

    $('#input-pat-tgl').keypress(function (e) {
        if (e.which == 13) {
            loginTgl()
            return false
        }
    })

    function request(url, credentials) {
        return $.ajax({
            type: 'GET',
            url: url,
            dataType: 'json',
            headers: {
                'Authorization': 'Basic ' + btoa(credentials)
            }
        })
    }

    function requestToggl(resource, params) {
        return request(
            'https://api.track.toggl.com/reports/api/' + resource + '?' +
            'workspace_id=' + workspaceId + '&' +
            'user_agent=adovis&' +
            $.param(params),
            credentialsTgl)
    }

    function requestVso(resource, params) {
        return request(
            'https://dev.azure.com/skype/SCC/_apis/' + resource + '?' +
            $.param(params),
            credentialsAdo
        )
    }

    function formatTime(totalSeconds) {
        let seconds = (Math.floor(totalSeconds % 60)).toString()
        totalMinutes = Math.floor(totalSeconds / 60)
        let minutes = (totalMinutes % 60).toString()
        let hours = Math.floor(totalMinutes / 60)
        return hours + ':' + minutes.padStart(2, '0') + ':' + seconds.padStart(2, '0')
    }

    function showNotification(text, cls, delay) {
        let notification = $('<div class="notification notification-' + cls + '">' + text + '</div>')
        $('body').append(notification)
        notification.delay(delay).fadeOut('1000')
    }

    class TogglDetailedReportItem {

        static async getDetailedReport(since, until) {
            let response = await requestToggl('v2/details', { 'since': since, 'until': until })
            console.log('get detailed report response', response)
            return response.data.map(function (item) {
                return TogglDetailedReportItem.fromToggleResponse(item)
            })
        }

        static fromToggleResponse(response) {

            let item = new TogglDetailedReportItem()

            item.id = response.id.toString()
            item.description = response.description
            item.start = Date.parse(response.start) / 1000
            item.end = Date.parse(response.end) / 1000
            item.project = response.project
            item.workItemId = TogglDetailedReportItem.getWorkItemId(response.description)
            item.duration = response.dur / 1000

            return item
        }

        static getWorkItemId(description) {

            if (!description.startsWith('Enabling Specification') &&
                !description.startsWith('Bug') &&
                !description.startsWith('Non-Functional Requirement'))
                return null

            let groups = /[a-zA-Z ]+([0-9]+).*/g.exec(description)

            if (!groups || groups.length < 2)
                return null

            return groups[1]
        }
    }

    class WorkItem {

        static async getManyById(ids) {
            if (ids.length == 0)
                return {}
            let response = await requestVso('wit/workitems', { 'ids': ids.join(','), '$expand': 'all', 'api-version': '1.0' })
            console.log('get many by id response', response)
            let result = {}
            for (const item of response.value) {
                let workItem = WorkItem.fromVsoResponse(item)
                let response = await requestVso('wit/workitems/' + workItem.id + '/comments', { 'api-version': '6.0-preview.3', 'order': 'desc', '$expand': 'none' })
                console.log('get comments', workItem.id, response)
                workItem.setComments(response.comments)
                result[item.id] = workItem
            }
            return result
        }

        static fromVsoResponse(response) {

            let item = new WorkItem()

            item.id = response.id.toString()
            item.wiType = response.fields['System.WorkItemType']
            item.title = response.fields['System.Title'].replace(/\[DOR\]/g, '')
            item.url = response._links.html.href.replace(/skype\.visualstudio\.com/, 'dev.azure.com/skype')
            item.storyPoints = response.fields['Microsoft.VSTS.Scheduling.StoryPoints']
            if (!item.storyPoints)
                item.storyPoints = 0

            return item
        }

        static getAssignedToShort(value) {
            return value ? value.replace(/[^A-Z]/g, '') : ''
        }

        setComments(comments) {
            this.comments = comments
            this.timeSpent = 0
            this.timeSpentRecordedAt = 0
            for (const comment of this.comments) {
                let groups = /total time spent([^0-9]+)([0-9]+):([0-9]+):([0-9]+)/g.exec(comment.text)
                if (comment.modifiedBy.uniqueName == emailAdo && groups && groups.length == 5) {
                    this.timeSpent = parseInt(groups[2]) * 3600 + parseInt(groups[3]) * 60 + parseInt(groups[4])
                    this.timeSpentRecordedAt = Date.parse(comment.modifiedDate) / 1000
                }
            }
        }
    }

    class RecentActivityItem {

        static async getRecentActivity() {

            let date = new Date()
            let formattedDate = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate()

            let detailedReport = await TogglDetailedReportItem.getDetailedReport('2020-09-24', formattedDate)

            let mergedActivityItems = {}

            for (const item of detailedReport) {

                if (!item.workItemId)
                    continue

                let key = item.workItemId
                if (!mergedActivityItems.hasOwnProperty(key)) {
                    mergedActivityItems[key] = RecentActivityItem.fromDetailedReportItem(item)
                } else {
                    mergedActivityItems[key].add(item)
                }
            }

            let recentActivity = Object.values(mergedActivityItems)
            recentActivity.sort(function (a, b) {
                let pa = a.mostRecentStart
                let pb = b.mostRecentStart
                if (pa > pb)
                    return -1
                else if (pa < pb)
                    return 1
                return 0
            })

            let workItemIds = recentActivity.map(item => item.workItemId)

            let workItems = await WorkItem.getManyById(workItemIds)

            for (const item of recentActivity) {
                item.workItem = workItems[item.workItemId]
            }

            return recentActivity
        }

        static fromDetailedReportItem(other) {

            let item = new RecentActivityItem()

            item.workItemId = other.workItemId
            item.description = other.description
            item.details = []
            item.mostRecentStart = other.start
            item.totalDuration = 0 // milliseconds

            item.add(other)

            return item
        }

        add(other) {
            this.details.append(other)
            this.totalDuration += other.duration
            if (other.start > this.mostRecentStart)
                this.mostRecentStart = other.start
        }

        getTimeSpentAfter(date) {
            let filtered = this.details.filter(detail => detail.end > date)
            let mapped = filtered.map(detail => detail.end - Math.max(detail.start, date))
            let reduced = mapped.reduce((a, b) => a + b, 0)
            console.log('getTimeSpentAfter', new Date(date * 1000), mapped, reduced)
            return reduced
        }
    }

    async function renderReport() {

        let recentActivity = await RecentActivityItem.getRecentActivity()

        let wait = $('#wait')
        let reportTable = $('#report')
        let emptyReport = $('#empty-report')
        reportTable.empty()

        if (recentActivity.length == 0) {
            wait.hide()
            reportTable.hide()
            emptyReport.show()
            return
        }

        reportTable.append(
            '<tr class="header">' +
            '<td>Work item</td>' +
            '<td>Points</td>' +
            '<td>Time spent</td>' +
            '<td>Recorded at</td>' +
            '<td>Not recorded time</td>' +
            '<td>Record time</td>' +
            '<td>Set points to</td>' +
            '</tr>')

        for (const item of recentActivity) {

            let workItem = item.workItem

            let timeSpentRecordedAt = workItem.timeSpentRecordedAt ? new Date(workItem.timeSpentRecordedAt * 1000).toLocaleString() : 'never'
            let notRecordedSpentTime = item.getTimeSpentAfter(workItem.timeSpentRecordedAt)

            let setSpentTime = workItem.timeSpent + notRecordedSpentTime

            const usefuleHoursPerDay = 6
            let setStoryPoints = workItem.storyPoints + Math.floor(notRecordedSpentTime / 3600 / usefuleHoursPerDay * 100) / 100

            reportTable.append(
                '<tr>' +
                '<td><a href="' + workItem.url + '" target="_blank">' + workItem.wiType + ' ' + workItem.id + '</a> ' + workItem.title + '</td>' +
                '<td>' + workItem.storyPoints + '</td>' +
                '<td>' + formatTime(workItem.timeSpent) + '</td>' +
                '<td>' + timeSpentRecordedAt + '</td>' +
                '<td>' + formatTime(notRecordedSpentTime) + '</td>' +
                '<td class="record-time">' + formatTime(setSpentTime) + '</td>' +
                '<td class="set-points">' + setStoryPoints + '</td>' +
                '</tr>')
        }

        reportTable.find('.record-time').click(function (e) {
            let $this = $(this)
            let text = 'total time spent ' + $this.text()
            navigator.clipboard.writeText(text).then(
                function() {
                    showNotification('Copied to clipboard', 'info', 1500)
                },
                function() {
                    showNotification('Failed to copy to clipboard', 'error', 1500)
                })
        })

        reportTable.find('.set-points').click(function (e) {
            let $this = $(this)
            let text = $this.text()
            navigator.clipboard.writeText(text).then(
                function() {
                    showNotification('Copied to clipboard', 'info', 1500)
                },
                function() {
                    showNotification('Failed to copy to clipboard', 'error', 1500)
                })
        })

        wait.hide()
        emptyReport.hide()
        reportTable.show()
    }

    if (credentialsAdo && emailAdo && credentialsTgl) {
        console.log('showing report')
        viewMain.show()
        await renderReport()
    } else if (credentialsAdo && emailAdo) {
        console.log('showing log in to tgl')
        viewLoginTgl.show()
    } else {
        console.log('showing log in to ado')
        viewLoginAdo.show()
    }
})