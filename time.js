$(document).ready(async function () {

    if (!Array.prototype.last) {
        Array.prototype.last = function () {
            return this[this.length - 1]
        }
    }

    let storage = window.localStorage

    let viewMain = $('#view-main')
    let viewLoginAdo = $('#view-login-ado')
    let viewLoginTgl = $('#view-login-tgl')

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

        credentialsAdo = 'adovis:' + $('#input-pat-ado').val()
        $('#input-pat-ado').val('')
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

        credentialsAdo = null
        credentialsTgl = null
        storage.removeItem('credentialsAdo')
        storage.removeItem('credentialsTgl')
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
            'https://skype.visualstudio.com/DefaultCollection/_apis/' + resource + '?' +
            'api-version=1.0&' +
            $.param(params),
            credentialsAdo
        )
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
            item.start = response.start
            item.end = response.end
            item.project = response.project
            item.date = TogglDetailedReportItem.getDate(response.start)
            item.workItemId = TogglDetailedReportItem.getWorkItemId(response.description)
            item.duration = response.dur

            return item
        }

        static getDate(start) {
            return start.split('T')[0]
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
            var response = await requestVso('wit/workitems', { 'ids': ids.join(','), '$expand': 'all' })
            console.log('get many by id response', response)
            let result = {}
            response.value.forEach(function (item) {
                result[item.id] = WorkItem.fromVsoResponse(item)
            })
            return result
        }

        static fromVsoResponse(response) {

            var item = new WorkItem()

            item.id = response.id.toString()
            item.wiType = response.fields['System.WorkItemType']
            item.title = response.fields['System.Title'].replace(/\[DOR\]/g, '')
            item.url = response._links.html.href.replace(/skype\.visualstudio\.com/, 'dev.azure.com/skype')
            item.state = response.fields['System.State']
            item.stateShort = response.fields['System.State'].replace(/ /g, '')
            item.swag = response.fields['Skype.Swag']
            item.assignedTo = response.fields['System.AssignedTo']
            item.assignedToShort = WorkItem.getAssignedToShort(item.assignedTo)
            item.column = response.fields['System.BoardColumn']
            item.columnShort = response.fields['System.BoardColumn'].replace(/ /g, '')
            if (!item.swag)
                item.swag = 1

            return item
        }

        static getAssignedToShort(value) {
            return value ? value.replace(/[^A-Z]/g, '') : ''
        }
    }

    class RecentActivityItem {

        static async getRecentActivity() {

            let date = new Date()
            let formattedDate = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate()

            let detailedReport = await TogglDetailedReportItem.getDetailedReport('2020-09-24', formattedDate)

            let mergedActivityItems = {}

            detailedReport.forEach(function (item) {

                if (!item.workItemId)
                    return

                let key = item.workItemId
                if (!mergedActivityItems.hasOwnProperty(key)) {
                    mergedActivityItems[key] = RecentActivityItem.fromDetailedReportItem(item)
                } else {
                    mergedActivityItems[key].add(item)
                }
            })

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

            recentActivity.forEach(function (item) {
                item.workItem = workItems[item.workItemId]
            })

            return recentActivity
        }

        static fromDetailedReportItem(response) {

            let item = new RecentActivityItem()

            item.workItemId = response.workItemId
            item.description = response.description
            item.mostRecentStart = response.start
            item.duration = response.duration

            return item
        }

        add(other) {
            this.duration += other.duration
            if (other.start > this.mostRecentStart)
                this.mostRecentStart = other.start
        }

        durationFormatted() {
            let totalSeconds = this.duration / 1000
            let seconds = (totalSeconds % 60).toString()
            let minutes = Math.floor(totalSeconds / 60).toString()
            let hours = Math.floor(totalSeconds / 3600).toString()
            return hours + ':' + minutes.padStart(2, '0') + ':' + seconds.padStart(2, '0')
        }
    }

    async function renderReport() {

        let recentActivity = await RecentActivityItem.getRecentActivity()

        let reportTable = $('#report')
        reportTable.empty()
        reportTable.append(
            '<tr class="header">' +
            '<td>Work item</td>' +
            '<td>Time spent</td>' +
            '</tr>')

        recentActivity.forEach(function (item) {
            let workItem = item.workItem
            reportTable.append(
                '<tr>' +
                '<td><a href="' + workItem.url + '" target="_blank">' + workItem.wiType + ' ' + workItem.id + '</a> ' + workItem.title + '</td>' +
                '<td>' + item.durationFormatted() + '</td>' +
                '</tr>')
        })
    }

    if (credentialsAdo && credentialsTgl) {
        console.log('showing report')
        viewMain.show()
        await renderReport()
    } else if (credentialsAdo) {
        console.log('showing log in to tgl')
        viewLoginTgl.show()
    } else {
        console.log('showing log in to ado')
        viewLoginAdo.show()
    }
})