$ErrorActionPreference = 'Stop'
$script:Root = $PSScriptRoot
$script:DataDir = Join-Path $Root 'datos-centro-control'
$script:UploadDir = Join-Path $script:DataDir 'archivos'
$script:StatePath = Join-Path $script:DataDir 'registro.json'
$script:HtmlPath = Join-Path $Root 'centro-de-control-boceto-integrado.html'
$script:Sessions = @{}
New-Item -ItemType Directory -Force -Path $script:UploadDir | Out-Null
if (Test-Path $script:StatePath) {
    $script:State = Get-Content -Raw -Encoding UTF8 $script:StatePath | ConvertFrom-Json
} else {
    $script:State = [pscustomobject]@{
        allowedEmails = @('brandonlasteros31@gmail.com', 'gledymedina02@gmail.com')
        invitations = @()
        users = @()
        submissions = @()
    }
}
if (-not $script:State.PSObject.Properties['project']) { $script:State | Add-Member -NotePropertyName project -NotePropertyValue ([pscustomobject]@{}) }
if (-not $script:State.PSObject.Properties['workspace']) { $script:State | Add-Member -NotePropertyName workspace -NotePropertyValue ([pscustomobject]@{ workers = @(); activities = @(); comments = @(); sources = [pscustomobject]@{ reports = ''; activities = ''; comments = ''; other = '' } }) }
foreach ($section in @('workers','activities','comments')) { if (-not $script:State.workspace.PSObject.Properties[$section]) { $script:State.workspace | Add-Member -NotePropertyName $section -NotePropertyValue @() } }
if (-not $script:State.workspace.PSObject.Properties['sources']) { $script:State.workspace | Add-Member -NotePropertyName sources -NotePropertyValue ([pscustomobject]@{ byWeek = @{} }) }
if (-not $script:State.workspace.sources.PSObject.Properties['byWeek']) { $script:State.workspace.sources | Add-Member -NotePropertyName byWeek -NotePropertyValue @{} }
if (-not $script:State.PSObject.Properties['revision']) { $script:State | Add-Member -NotePropertyName revision -NotePropertyValue 0 }
if (-not $script:State.PSObject.Properties['auditLog']) { $script:State | Add-Member -NotePropertyName auditLog -NotePropertyValue @() }
foreach ($account in @($script:State.users)) { if (-not $account.PSObject.Properties['draft']) { $account | Add-Member -NotePropertyName draft -NotePropertyValue ([pscustomobject]@{}) } }
$script:CurrentActor = 'sistema'
foreach ($submission in @($script:State.submissions)) {
    if (-not $submission.PSObject.Properties['editAuthorized']) { $submission | Add-Member -NotePropertyName editAuthorized -NotePropertyValue $false }
    if (-not $submission.PSObject.Properties['editRequestStatus']) { $submission | Add-Member -NotePropertyName editRequestStatus -NotePropertyValue 'none' }
    if (-not $submission.PSObject.Properties['editRequestNote']) { $submission | Add-Member -NotePropertyName editRequestNote -NotePropertyValue '' }
}
function Save-State([string]$Action = '', [string]$Detail = '') {
    if ($Action) {
        $script:State.revision = [int]$script:State.revision + 1
        $detailText = ([string]$Detail).Trim()
        if ($detailText.Length -gt 2000) { $detailText = $detailText.Substring(0, 1997) + '...' }
        $entry = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); at = (Get-Date).ToString('o'); actor = $script:CurrentActor; action = $Action; detail = $detailText; revision = [int]$script:State.revision }
        $script:State.auditLog = @($script:State.auditLog) + @($entry)
        if (@($script:State.auditLog).Count -gt 1000) { $script:State.auditLog = @($script:State.auditLog | Select-Object -Last 1000) }
    }
    $json = ConvertTo-Json -InputObject $script:State -Depth 30
    [System.IO.File]::WriteAllText($script:StatePath, $json, [System.Text.UTF8Encoding]::new($false))
}
function Send-Json($Context, $Value, [int]$Status = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 30 -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}
function Read-Body($Context) {
    if ($Context.Request.ContentLength64 -gt 150000000) { throw 'El envío supera el máximo de 150 MB.' }
    $reader = [System.IO.StreamReader]::new($Context.Request.InputStream, $Context.Request.ContentEncoding)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Read-Json($Context) {
    $text = Read-Body $Context
    if ([string]::IsNullOrWhiteSpace($text)) { throw 'Faltan datos.' }
    return ($text | ConvertFrom-Json)
}
function New-PasswordRecord([string]$Password) {
    $salt = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
    $derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Password, $salt, 150000)
    try { return @{ salt = [Convert]::ToBase64String($salt); hash = [Convert]::ToBase64String($derive.GetBytes(32)) } }
    finally { $derive.Dispose() }
}
function Test-Password($User, [string]$Password) {
    $salt = [Convert]::FromBase64String($User.salt)
    $derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Password, $salt, 150000)
    try {
        $actual = [Convert]::ToBase64String($derive.GetBytes(32))
        return $actual -ceq $User.hash
    } finally { $derive.Dispose() }
}
function Get-User($Context) {
    $header = $Context.Request.Headers['Authorization']
    if ($header -notmatch '^Bearer (.+)$') { return $null }
    $token = $Matches[1]
    if ($script:Sessions.ContainsKey($token)) {
        $email = $script:Sessions[$token]
        return @($script:State.users | Where-Object { $_.email -eq $email } | Select-Object -First 1)[0]
    }
    return $null
}
function Require-Admin($Context) {
    $user = Get-User $Context
    if (-not $user -or $user.role -ne 'admin') { Send-Json $Context @{ error = 'Necesitas entrar como administrador.' } 401; return $null }
    return $user
}
function Find-Submission([string]$Id) {
    return @($script:State.submissions | Where-Object { $_.id -eq $Id } | Select-Object -First 1)[0]
}
function Remove-SubmissionFilesIfUnused($RemovedSubmissions) {
    $deleted = 0
    foreach ($submission in @($RemovedSubmissions)) {
        foreach ($file in @($submission.files)) {
            $fileId = [string]$file.id
            if ($fileId -notmatch '^[0-9a-f]{32}$') { continue }
            $stillUsed = $false
            foreach ($remaining in @($script:State.submissions)) {
                if (@($remaining.files | Where-Object { [string]$_.id -eq $fileId }).Count -gt 0) { $stillUsed = $true; break }
            }
            $storedFile = Join-Path $script:UploadDir ($fileId + '.bin')
            if (-not $stillUsed -and (Test-Path -LiteralPath $storedFile)) { Remove-Item -LiteralPath $storedFile -Force; $deleted++ }
        }
    }
    return $deleted
}
function Handle-Request($Context) {
    $script:CurrentActor = 'sistema'
    $path = $Context.Request.Url.AbsolutePath
    $method = $Context.Request.HttpMethod
    if ($method -eq 'GET' -and $path -in @('/', '/demo', '/antes-fechas')) {
        $pagePath = if ($path -eq '/demo') { Join-Path $script:Root 'centro-de-control-demo.html' } elseif ($path -eq '/antes-fechas') { Join-Path $script:Root 'centro-de-control-antes-fechas.html' } else { $script:HtmlPath }
        if (-not (Test-Path $pagePath)) { Send-Json $Context @{ error = 'No se encuentra el archivo HTML.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($pagePath)
        $Context.Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        $Context.Response.ContentType = 'text/html; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-share.js') {
        $scriptPath = Join-Path $script:Root 'centro-control-share.js'
        if (-not (Test-Path $scriptPath)) { Send-Json $Context @{ error = 'No se encuentra el archivo de entregas.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($scriptPath)
        $Context.Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        $Context.Response.ContentType = 'application/javascript; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-share-antes-fechas.js') {
        $scriptPath = Join-Path $script:Root 'centro-control-share-antes-fechas.js'
        if (-not (Test-Path $scriptPath)) { Send-Json $Context @{ error = 'No se encuentra la copia anterior.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($scriptPath)
        $Context.Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        $Context.Response.ContentType = 'application/javascript; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-ubigeo.json') {
        $catalogPath = Join-Path $script:Root 'centro-control-ubigeo.json'
        if (-not (Test-Path $catalogPath)) { Send-Json $Context @{ error = 'No se encuentra la lista de ubicaciones.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($catalogPath)
        $Context.Response.ContentType = 'application/json; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-ubigeo.json') {
        $catalogPath = Join-Path $script:Root 'centro-control-ubigeo.json'
        if (-not (Test-Path $catalogPath)) { Send-Json $Context @{ error = 'No se encuentra la lista de ubicaciones.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($catalogPath)
        $Context.Response.ContentType = 'application/json; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/templates') {
        if (-not (Get-User $Context)) { Send-Json $Context @{ error = 'Inicia sesión para ver las plantillas.' } 401; return }
        $templatePath = Join-Path $script:Root 'Plantilla - Informe mensual y final (Administracion Directa).md'
        $supervisionPath = Join-Path $script:Root 'Plantilla - Informe mensual y final (Supervision Administracion Directa).md'
        $contractPath = Join-Path $script:Root 'Plantilla - Informes de obra por contrata.md'
        if (-not (Test-Path $templatePath) -or -not (Test-Path $supervisionPath) -or -not (Test-Path $contractPath)) { Send-Json $Context @{ error = 'No se encuentran las plantillas de informes.' } 404; return }
        $templateText = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
        $monthlyMarker = '# 1. INFORME MENSUAL DEL RESIDENTE DE OBRA'
        $finalMarker = '# 2. INFORME FINAL DE OBRA / PRELIQUIDACION'
        $monthlyIndex = $templateText.IndexOf($monthlyMarker, [System.StringComparison]::Ordinal)
        $finalIndex = $templateText.IndexOf($finalMarker, [System.StringComparison]::Ordinal)
        if ($monthlyIndex -lt 0 -or $finalIndex -le $monthlyIndex) { Send-Json $Context @{ error = 'No se pudo leer el contenido de las plantillas.' } 500; return }
        $monthlyTemplate = $templateText.Substring($monthlyIndex, $finalIndex - $monthlyIndex).Trim()
        $finalTemplate = $templateText.Substring($finalIndex).Trim()
        $supervisionText = [System.IO.File]::ReadAllText($supervisionPath, [System.Text.Encoding]::UTF8)
        $supervisionMonthlyMarker = '# 1. INFORME MENSUAL DE SUPERVISI' + [char]0x00D3 + 'N Y VALORIZACI' + [char]0x00D3 + 'N'
        $supervisionFinalMarker = '# 2. INFORME DE REVISI' + [char]0x00D3 + 'N Y PRONUNCIAMIENTO SOBRE EL INFORME FINAL DE OBRA'
        $supervisionMonthlyIndex = $supervisionText.IndexOf($supervisionMonthlyMarker, [System.StringComparison]::Ordinal)
        $supervisionFinalIndex = $supervisionText.IndexOf($supervisionFinalMarker, [System.StringComparison]::Ordinal)
        if ($supervisionMonthlyIndex -lt 0 -or $supervisionFinalIndex -le $supervisionMonthlyIndex) { Send-Json $Context @{ error = 'No se pudo leer la plantilla de supervisión.' } 500; return }
        $supervisionMonthlyTemplate = $supervisionText.Substring($supervisionMonthlyIndex, $supervisionFinalIndex - $supervisionMonthlyIndex).Trim()
        $supervisionFinalTemplate = $supervisionText.Substring($supervisionFinalIndex).Trim()
        $contractText = [System.IO.File]::ReadAllText($contractPath, [System.Text.Encoding]::UTF8)
        $contractMarkers = @(
            '# 1. INFORME MENSUAL DE OBRA POR CONTRATA - RESIDENTE',
            '# 2. INFORME DE CIERRE DE OBRA POR CONTRATA - RESIDENTE',
            '# 3. INFORME MENSUAL DE SUPERVISION DE OBRA POR CONTRATA',
            '# 4. INFORME DE CIERRE Y PRONUNCIAMIENTO DE SUPERVISION POR CONTRATA'
        )
        $contractIndices = @($contractMarkers | ForEach-Object { $contractText.IndexOf($_, [System.StringComparison]::Ordinal) })
        if ($contractIndices[0] -lt 0 -or $contractIndices[1] -le $contractIndices[0] -or $contractIndices[2] -le $contractIndices[1] -or $contractIndices[3] -le $contractIndices[2]) { Send-Json $Context @{ error = 'No se pudo leer la plantilla de obra por contrata.' } 500; return }
        $contractMonthly = $contractText.Substring($contractIndices[0], $contractIndices[1] - $contractIndices[0]).Trim()
        $contractFinal = $contractText.Substring($contractIndices[1], $contractIndices[2] - $contractIndices[1]).Trim()
        $contractSupervisorMonthly = $contractText.Substring($contractIndices[2], $contractIndices[3] - $contractIndices[2]).Trim()
        $contractSupervisorFinal = $contractText.Substring($contractIndices[3]).Trim()
        Send-Json $Context @{ monthly = $monthlyTemplate; final = $finalTemplate; supervisorMonthly = $supervisionMonthlyTemplate; supervisorFinal = $supervisionFinalTemplate; contractMonthly = $contractMonthly; contractFinal = $contractFinal; contractSupervisorMonthly = $contractSupervisorMonthly; contractSupervisorFinal = $contractSupervisorFinal }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/templates/download') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $type = [string]$data.type
        $isContract = $type -in @('contractMonthly','contractFinal','contractSupervisorMonthly','contractSupervisorFinal')
        $isSupervision = $type -in @('supervisorMonthly','supervisorFinal')
        $templatePath = if ($isContract) { Join-Path $script:Root 'Plantilla - Informes de obra por contrata.md' } elseif ($isSupervision) { Join-Path $script:Root 'Plantilla - Informe mensual y final (Supervision Administracion Directa).md' } else { Join-Path $script:Root 'Plantilla - Informe mensual y final (Administracion Directa).md' }
        if (-not (Test-Path $templatePath)) { Send-Json $Context @{ error = 'No se encuentran las plantillas de informes.' } 404; return }
        $templateText = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
        if ($isContract) {
            $contractMarkers = @(
                '# 1. INFORME MENSUAL DE OBRA POR CONTRATA - RESIDENTE',
                '# 2. INFORME DE CIERRE DE OBRA POR CONTRATA - RESIDENTE',
                '# 3. INFORME MENSUAL DE SUPERVISION DE OBRA POR CONTRATA',
                '# 4. INFORME DE CIERRE Y PRONUNCIAMIENTO DE SUPERVISION POR CONTRATA'
            )
            $contractIndices = @($contractMarkers | ForEach-Object { $templateText.IndexOf($_, [System.StringComparison]::Ordinal) })
            if ($contractIndices[0] -lt 0 -or $contractIndices[1] -le $contractIndices[0] -or $contractIndices[2] -le $contractIndices[1] -or $contractIndices[3] -le $contractIndices[2]) { Send-Json $Context @{ error = 'No se pudo leer la plantilla de obra por contrata.' } 500; return }
            $template = switch ($type) {
                'contractMonthly' { $templateText.Substring($contractIndices[0], $contractIndices[1] - $contractIndices[0]).Trim() }
                'contractFinal' { $templateText.Substring($contractIndices[1], $contractIndices[2] - $contractIndices[1]).Trim() }
                'contractSupervisorMonthly' { $templateText.Substring($contractIndices[2], $contractIndices[3] - $contractIndices[2]).Trim() }
                'contractSupervisorFinal' { $templateText.Substring($contractIndices[3]).Trim() }
            }
            Send-Json $Context @{ template = $template }
            return
        }
        $monthlyMarker = if ($isSupervision) { '# 1. INFORME MENSUAL DE SUPERVISI' + [char]0x00D3 + 'N Y VALORIZACI' + [char]0x00D3 + 'N' } else { '# 1. INFORME MENSUAL DEL RESIDENTE DE OBRA' }
        $finalMarker = if ($isSupervision) { '# 2. INFORME DE REVISI' + [char]0x00D3 + 'N Y PRONUNCIAMIENTO SOBRE EL INFORME FINAL DE OBRA' } else { '# 2. INFORME FINAL DE OBRA / PRELIQUIDACION' }
        $monthlyIndex = $templateText.IndexOf($monthlyMarker, [System.StringComparison]::Ordinal)
        $finalIndex = $templateText.IndexOf($finalMarker, [System.StringComparison]::Ordinal)
        if ($monthlyIndex -lt 0 -or $finalIndex -le $monthlyIndex) { Send-Json $Context @{ error = 'No se pudo leer el contenido de las plantillas.' } 500; return }
        $template = if ($type -in @('monthly','supervisorMonthly')) { $templateText.Substring($monthlyIndex, $finalIndex - $monthlyIndex).Trim() } elseif ($type -in @('final','supervisorFinal')) { $templateText.Substring($finalIndex).Trim() } else { Send-Json $Context @{ error = 'Selecciona una plantilla válida.' } 400; return }
        Send-Json $Context @{ template = $template }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/status') {
        Send-Json $Context @{ setup = (@($script:State.users | Where-Object role -eq 'admin').Count -eq 0); adminEmail = 'brandonlasteros31@gmail.com' }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/project') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $previousProject = $script:State.project
        $executionType = ([string]$data.executionType).Trim()
        if ($executionType -and $executionType -notin @('Administración directa','Obra por contrata')) { Send-Json $Context @{ error = 'Selecciona administración directa u obra por contrata.' } 400; return }
        $locationCodes = @([string]$data.departmentCode, [string]$data.provinceCode, [string]$data.districtCode)
        if (($locationCodes | Where-Object { $_ } | Measure-Object).Count -gt 0) {
            if ($locationCodes.Where({ -not $_ }).Count -gt 0) { Send-Json $Context @{ error = 'Selecciona departamento, provincia y distrito.' } 400; return }
            $catalog = Get-Content -Raw -Encoding UTF8 (Join-Path $script:Root 'centro-control-ubigeo.json') | ConvertFrom-Json
            $department = @($catalog.departments | Where-Object { [string]$_.id -eq [string]$data.departmentCode } | Select-Object -First 1)[0]
            $province = @($catalog.provinces | Where-Object { [string]$_.id -eq [string]$data.provinceCode -and [string]$_.department_id -eq [string]$data.departmentCode } | Select-Object -First 1)[0]
            $district = @($catalog.districts | Where-Object { [string]$_.id -eq [string]$data.districtCode -and [string]$_.province_id -eq [string]$data.provinceCode -and [string]$_.department_id -eq [string]$data.departmentCode } | Select-Object -First 1)[0]
            if (-not $department -or -not $province -or -not $district) { Send-Json $Context @{ error = 'La ubicación seleccionada no es válida.' } 400; return }
        } else {
            $department = $null; $province = $null; $district = $null
        }
        $script:State.project = [pscustomobject]@{
            name = ([string]$data.name).Trim()
            entity = ([string]$data.entity).Trim()
            executionType = $executionType
            code = ([string]$data.code).Trim()
            cutoff = [string]$data.cutoff
            description = ([string]$data.description).Trim()
            techReportRole = if ([string]$data.techReportRole -eq 'supervisor') { 'supervisor' } else { 'resident' }
            techExecutiveUnit = ([string]$data.techExecutiveUnit).Trim()
            techPliego = ([string]$data.techPliego).Trim()
            techWorkStatus = ([string]$data.techWorkStatus).Trim()
            techWorkTermDays = ([string]$data.techWorkTermDays).Trim()
            techExecutionSystem = ([string]$data.techExecutionSystem).Trim()
            techWorkEnd = [string]$data.techWorkEnd
            techResidentName = ([string]$data.techResidentName).Trim()
            techResidentDni = ([string]$data.techResidentDni).Trim()
            techResidentCip = ([string]$data.techResidentCip).Trim()
            techResidentDesignation = ([string]$data.techResidentDesignation).Trim()
            techResidentAmount = ([string]$data.techResidentAmount).Trim()
            techResidentResolutionDate = [string]$data.techResidentResolutionDate
            techResidentServiceStart = [string]$data.techResidentServiceStart
            techResidentServiceEnd = [string]$data.techResidentServiceEnd
            techSupervisorName = ([string]$data.techSupervisorName).Trim()
            techSupervisorDni = ([string]$data.techSupervisorDni).Trim()
            techSupervisorCip = ([string]$data.techSupervisorCip).Trim()
            techSupervisorDesignation = ([string]$data.techSupervisorDesignation).Trim()
            techSupervisorAmount = ([string]$data.techSupervisorAmount).Trim()
            techSupervisorResolutionDate = [string]$data.techSupervisorResolutionDate
            techSupervisorServiceStart = [string]$data.techSupervisorServiceStart
            techSupervisorServiceEnd = [string]$data.techSupervisorServiceEnd
            techOffice = ([string]$data.techOffice).Trim()
            techFunctionalSequence = ([string]$data.techFunctionalSequence).Trim()
            techFiscalYear = ([string]$data.techFiscalYear).Trim()
            techFundingSource = ([string]$data.techFundingSource).Trim()
            techApprovedBudget = ([string]$data.techApprovedBudget).Trim()
            techAnalyticalBudget = ([string]$data.techAnalyticalBudget).Trim()
            techExecutedBudget = ([string]$data.techExecutedBudget).Trim()
            techCompletedGoals = ([string]$data.techCompletedGoals).Trim()
            techExpedientApproval = ([string]$data.techExpedientApproval).Trim()
            techLandDelivery = ([string]$data.techLandDelivery).Trim()
            techWorkStart = ([string]$data.techWorkStart).Trim()
            techViability = ([string]$data.techViability).Trim()
            techInfobras = ([string]$data.techInfobras).Trim()
            techContractNumber = ([string]$data.techContractNumber).Trim()
            techContractObject = ([string]$data.techContractObject).Trim()
            techContractor = ([string]$data.techContractor).Trim()
            techContractAmount = ([string]$data.techContractAmount).Trim()
            techDeliverySystem = ([string]$data.techDeliverySystem).Trim()
            techContractTerm = ([string]$data.techContractTerm).Trim()
            techContractStart = ([string]$data.techContractStart).Trim()
            techContractEnd = ([string]$data.techContractEnd).Trim()
            techDirectApprovalReports = ([string]$data.techDirectApprovalReports).Trim()
            techDirectKeyStaff = ([string]$data.techDirectKeyStaff).Trim()
            techDirectExpedientReview = ([string]$data.techDirectExpedientReview).Trim()
            techDirectSupplyPlan = ([string]$data.techDirectSupplyPlan).Trim()
            techDirectPeriodProgress = ([string]$data.techDirectPeriodProgress).Trim()
            techDirectQualitySafety = ([string]$data.techDirectQualitySafety).Trim()
            techDirectChanges = ([string]$data.techDirectChanges).Trim()
            techDirectCloseout = ([string]$data.techDirectCloseout).Trim()
            techContractSupervisor = ([string]$data.techContractSupervisor).Trim()
            techContractSchedule = ([string]$data.techContractSchedule).Trim()
            techContractValuations = ([string]$data.techContractValuations).Trim()
            techContractChanges = ([string]$data.techContractChanges).Trim()
            techContractCloseout = ([string]$data.techContractCloseout).Trim()
            departmentCode = if ($department) { [string]$department.id } else { '' }
            department = if ($department) { [string]$department.name } else { '' }
            provinceCode = if ($province) { [string]$province.id } else { '' }
            province = if ($province) { [string]$province.name } else { '' }
            districtCode = if ($district) { [string]$district.id } else { '' }
            district = if ($district) { [string]$district.name } else { '' }
            location = if ($district) { [string]$district.name + ', ' + [string]$province.name + ', ' + [string]$department.name } else { '' }
        }
        $projectChanges = @()
        foreach ($field in @('name','entity','executionType','code','cutoff','description','location','techReportRole','techExecutiveUnit','techPliego','techWorkStatus','techWorkTermDays','techExecutionSystem','techWorkEnd','techResidentName','techResidentCip','techResidentDesignation','techResidentAmount','techResidentResolutionDate','techResidentServiceStart','techResidentServiceEnd','techSupervisorName','techSupervisorCip','techSupervisorDesignation','techSupervisorAmount','techSupervisorResolutionDate','techSupervisorServiceStart','techSupervisorServiceEnd','techOffice','techFunctionalSequence','techFiscalYear','techFundingSource','techApprovedBudget','techAnalyticalBudget','techExecutedBudget','techCompletedGoals','techExpedientApproval','techLandDelivery','techWorkStart','techViability','techInfobras','techContractNumber','techContractObject','techContractor','techContractAmount','techDeliverySystem','techContractTerm','techContractStart','techContractEnd','techDirectApprovalReports','techDirectKeyStaff','techDirectExpedientReview','techDirectSupplyPlan','techDirectPeriodProgress','techDirectQualitySafety','techDirectChanges','techDirectCloseout','techContractSupervisor','techContractSchedule','techContractValuations','techContractChanges','techContractCloseout')) {
            $before = [string]$previousProject.$field; $after = [string]$script:State.project.$field
            if ($before -cne $after) { $projectChanges += $field + ': ' + $before + ' -> ' + $after }
        }
        Save-State 'Proyecto actualizado' ($projectChanges -join '; ')
        Send-Json $Context @{ ok = $true; project = $script:State.project }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/setup') {
        $data = Read-Json $Context
        if (@($script:State.users | Where-Object role -eq 'admin').Count -gt 0) { Send-Json $Context @{ error = 'La cuenta de administración ya está creada.' } 409; return }
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        if ($email -ne 'brandonlasteros31@gmail.com') { Send-Json $Context @{ error = 'Usa el correo de administrador indicado.' } 403; return }
        if ([string]$data.password -cne [string]$data.confirm -or ([string]$data.password).Length -lt 10) { Send-Json $Context @{ error = 'La contraseña debe tener al menos 10 caracteres y coincidir.' } 400; return }
        $record = New-PasswordRecord ([string]$data.password)
        $script:State.users = @($script:State.users) + @([pscustomobject]@{ email = $email; salt = $record.salt; hash = $record.hash; role = 'admin'; created = (Get-Date).ToString('o') })
        $script:CurrentActor = $email
        Save-State 'Administrador creado' $email
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/activate') {
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        $displayName = ([string]$data.name).Trim()
        $invite = @($script:State.invitations | Where-Object { $_.email -eq $email -and $_.code -eq [string]$data.code -and -not $_.used } | Select-Object -First 1)[0]
        if (-not $invite -or $email -notin @($script:State.allowedEmails)) { Send-Json $Context @{ error = 'Correo o código de invitación incorrecto.' } 403; return }
        if (@($script:State.users | Where-Object email -eq $email).Count -gt 0) { Send-Json $Context @{ error = 'Ese correo ya tiene acceso.' } 409; return }
        if ($displayName.Length -lt 2 -or $displayName.Length -gt 80) { Send-Json $Context @{ error = 'Escribe tu nombre completo.' } 400; return }
        if (([string]$data.password).Length -lt 10 -or [string]$data.password -cne [string]$data.confirm) { Send-Json $Context @{ error = 'La contraseña debe tener al menos 10 caracteres y coincidir.' } 400; return }
        $record = New-PasswordRecord ([string]$data.password)
        $script:State.users = @($script:State.users) + @([pscustomobject]@{ email = $email; displayName = $displayName; salt = $record.salt; hash = $record.hash; role = 'staff'; created = (Get-Date).ToString('o'); draft = [pscustomobject]@{} })
        $invite.used = $true
        $script:CurrentActor = $displayName + ' (' + $email + ')'
        Save-State 'Cuenta activada' $email
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/login') {
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        $user = @($script:State.users | Where-Object email -eq $email | Select-Object -First 1)[0]
        if (-not $user -or -not (Test-Password $user ([string]$data.password))) { Send-Json $Context @{ error = 'Correo o contraseña incorrectos.' } 403; return }
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
        $script:Sessions[$token] = $email
        Send-Json $Context @{ token = $token; email = $email; role = $user.role }
        return
    }
    $user = Get-User $Context
    if ($user) { $script:CurrentActor = if ($user.displayName) { [string]$user.displayName + ' (' + [string]$user.email + ')' } else { [string]$user.email } }
    if ($method -eq 'POST' -and $path -eq '/api/reset-section') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $section = [string]$data.section
        switch ($section) {
            'project' {
                $script:State.project = [pscustomobject]@{}
                Save-State 'Datos del proyecto limpiados' 'Se conservó el equipo, el historial y los documentos enviados.'
            }
            'project-general' {
                foreach ($field in @('name','entity','executionType','code','cutoff','description','location','departmentCode','department','provinceCode','province','districtCode','district')) {
                    $property = $script:State.project.PSObject.Properties[$field]
                    if ($property) { $property.Value = '' }
                }
                Save-State 'Datos generales del proyecto limpiados' 'Se conservaron los datos tecnicos, trabajadores y entregas.'
            }
            'project-technical' {
                foreach ($property in @($script:State.project.PSObject.Properties | Where-Object { $_.Name -like 'tech*' })) {
                    $script:State.project | Add-Member -NotePropertyName $property.Name -NotePropertyValue '' -Force
                }
                Save-State 'Datos tecnicos del proyecto limpiados' 'Se conservaron los datos generales, trabajadores y entregas.'
            }
            'project-workers' {
                $count = @($script:State.workspace.workers).Count
                $script:State.workspace.workers = @()
                Save-State 'Equipo del proyecto limpiado' ($count.ToString() + ' responsables retirados; se conservaron cuentas y entregas.')
            }
            'control' {
                foreach ($account in @($script:State.users)) {
                    $account.draft = [pscustomobject]@{ report = [pscustomobject]@{}; valuation = [pscustomobject]@{}; conformity = [pscustomobject]@{} }
                }
                Save-State 'Borradores de Control limpiados' 'Se borraron los borradores sin enviar de las cuentas.'
            }
            { $_ -in @('control-report','control-valuation','control-conformity') } {
                $draftKey = switch ($section) { 'control-report' { 'report' } 'control-valuation' { 'valuation' } default { 'conformity' } }
                foreach ($account in @($script:State.users)) {
                    if (-not $account.draft) { $account | Add-Member -NotePropertyName draft -NotePropertyValue ([pscustomobject]@{}) }
                    $account.draft | Add-Member -NotePropertyName $draftKey -NotePropertyValue ([pscustomobject]@{}) -Force
                }
                $draftLabel = switch ($draftKey) { 'report' { 'informe' } 'valuation' { 'valorizacion' } default { 'orden de bienes y servicios' } }
                Save-State ('Borrador de ' + $draftLabel + ' limpiado') 'Se conservaron los demas borradores y entregas enviadas.'
            }
            'informe' {
                $activityCount = @($script:State.workspace.activities).Count
                $commentCount = @($script:State.workspace.comments).Count
                $script:State.workspace.activities = @()
                $script:State.workspace.comments = @()
                $script:State.workspace.sources = [pscustomobject]@{ byWeek = @{} }
                Save-State 'Datos semanales del informe limpiados' ($activityCount.ToString() + ' actividades y ' + $commentCount.ToString() + ' comentarios; se conservaron proyecto y entregas.')
            }
            'informe-activities' {
                $count = @($script:State.workspace.activities).Count
                $script:State.workspace.activities = @()
                Save-State 'Actividades del informe limpiadas' ($count.ToString() + ' actividades eliminadas.')
            }
            'informe-comments' {
                $count = @($script:State.workspace.comments).Count
                $script:State.workspace.comments = @()
                Save-State 'Comentarios del informe limpiados' ($count.ToString() + ' comentarios eliminados.')
            }
            'informe-sources' {
                $script:State.workspace.sources = [pscustomobject]@{ byWeek = @{} }
                Save-State 'Fuentes semanales del informe limpiadas' 'Se conservaron proyecto, actividades, comentarios y entregas.'
            }
            'informe-history' {
                $count = @($script:State.auditLog).Count
                $script:State.auditLog = @()
                Save-State 'Historial de cambios reiniciado' ($count.ToString() + ' registros anteriores eliminados; se dejo constancia de esta limpieza.')
            }
            { $_ -in @('entregas-informes','entregas-valorizaciones','entregas-conformidades') } {
                $kind = switch ($section) { 'entregas-valorizaciones' { 'valuation' } 'entregas-conformidades' { 'conformity' } default { 'report' } }
                $removed = if ($kind -eq 'report') { @($script:State.submissions | Where-Object { $_.kind -ne 'valuation' -and $_.kind -ne 'conformity' }) } else { @($script:State.submissions | Where-Object { $_.kind -eq $kind }) }
                $removedIds = @($removed | ForEach-Object { [string]$_.id })
                $script:State.submissions = @($script:State.submissions | Where-Object { [string]$_.id -notin $removedIds })
                $fileCount = Remove-SubmissionFilesIfUnused $removed
                $kindLabel = switch ($kind) { 'valuation' { 'valorizaciones' } 'conformity' { 'ordenes de bienes y servicios' } default { 'informes' } }
                Save-State ('Entregas de ' + $kindLabel + ' eliminadas') ($removed.Count.ToString() + ' entregas; ' + $fileCount.ToString() + ' archivos sin referencias eliminados.')
            }
            'submission' {
                $submissionId = [string]$data.id
                if ($submissionId -notmatch '^[0-9a-f]{32}$') { Send-Json $Context @{ error = 'No se reconoce la entrega que quieres eliminar.' } 400; return }
                $removed = Find-Submission $submissionId
                if (-not $removed) { Send-Json $Context @{ error = 'La entrega ya no existe o fue eliminada.' } 404; return }
                $script:State.submissions = @($script:State.submissions | Where-Object { [string]$_.id -ne $submissionId })
                $fileCount = Remove-SubmissionFilesIfUnused @($removed)
                Save-State 'Entrega eliminada' ($removed.title + '; ' + $fileCount.ToString() + ' archivos sin referencias eliminados.')
            }
            'entregas' {
                $submissionCount = @($script:State.submissions).Count
                $fileCount = 0
                foreach ($submission in @($script:State.submissions)) {
                    foreach ($file in @($submission.files)) {
                        $fileId = [string]$file.id
                        if ($fileId -match '^[0-9a-f]{32}$') {
                            $storedFile = Join-Path $script:UploadDir ($fileId + '.bin')
                            if (Test-Path -LiteralPath $storedFile) { Remove-Item -LiteralPath $storedFile -Force; $fileCount++ }
                        }
                    }
                }
                $script:State.submissions = @()
                Save-State 'Entregas y archivos eliminados' ($submissionCount.ToString() + ' entregas; ' + $fileCount.ToString() + ' archivos adjuntos eliminados.')
            }
            default { Send-Json $Context @{ error = 'Selecciona un apartado válido.' } 400; return }
        }
        Send-Json $Context @{ ok = $true; section = $section; revision = [int]$script:State.revision }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/live') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesion.' } 401; return }
        $items = @($script:State.submissions | Where-Object { $user.role -eq 'admin' -or $_.email -eq $user.email } | Sort-Object created -Descending)
        $audit = @($script:State.auditLog | Select-Object -Last 100 | Sort-Object at -Descending)
        if ($user.role -ne 'admin') {
            $items = @($items | ForEach-Object { $visibleItem = $_ | Select-Object *; $visibleItem.review = ''; $visibleItem.reviewed = ''; $visibleItem })
            $audit = @($audit | Where-Object { $_.action -ne 'Entrega revisada' })
        }
        Send-Json $Context @{ revision = [int]$script:State.revision; project = $script:State.project; workspace = $script:State.workspace; submissions = $items; auditLog = $audit }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/draft') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión para recuperar tus datos.' } 401; return }
        Send-Json $Context @{ draft = $user.draft }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/draft') {
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Solo las cuentas de trabajador guardan borradores.' } 403; return }
        $data = Read-Json $Context
        $allowedFields = @{
            report = @('reportTitle','reportNumber','reportDate','reportResponsible','reportNote','reportPeriodStart','reportPeriodEnd','reportPeriodSummary','reportOccurrences','reportNotebookLink','reportQuality','reportQualityLink','reportSafetyEnvironment','reportSafetyLink','reportConclusions','reportRecommendations')
            valuation = @('valuationNumber','valuationPeriod','valuationDue','valuationPlanned','valuationActual','valuationFilePlanned','valuationFileActual','valuationNote','reportResponsible','valuationMonthlyPlanned','valuationMonthlyActual','valuationAmount','valuationCumulativeAmount','valuationFinancialProgress','valuationMeasurements','valuationPaymentStatus')
            conformity = @('conformityCategory','conformityTitle','conformityProvider','conformityAmount','conformityDate','conformityDue','conformityNote')
        }
        $savedDraft = [ordered]@{}
        foreach ($formName in $allowedFields.Keys) {
            $formDraft = [ordered]@{}
            $incoming = $data.draft.$formName
            foreach ($field in $allowedFields[$formName]) {
                $property = if ($incoming) { $incoming.PSObject.Properties[$field] } else { $null }
                if ($property) {
                    $value = [string]$property.Value
                    if ($value.Length -gt 2000) { $value = $value.Substring(0,2000) }
                    $formDraft[$field] = $value
                } elseif ($user.draft -and $user.draft.$formName -and $user.draft.$formName.PSObject.Properties[$field]) {
                    $formDraft[$field] = [string]$user.draft.$formName.$field
                }
            }
            $savedDraft[$formName] = [pscustomobject]$formDraft
        }
        $user.draft = [pscustomobject]$savedDraft
        Save-State 'Borrador de trabajador actualizado' ($user.email + ' · datos de formularios')
        Send-Json $Context @{ ok = $true; revision = [int]$script:State.revision }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/workspace') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesiÃ³n para actualizar el espacio de trabajo.' } 401; return }
        $data = Read-Json $Context
        $section = [string]$data.section
        $action = [string]$data.action
        if ($section -notin @('workers','activities','comments','sources')) { Send-Json $Context @{ error = 'SecciÃ³n no vÃ¡lida.' } 400; return }
        if ($section -eq 'sources') {
            if ($action -ne 'set') { Send-Json $Context @{ error = 'AcciÃ³n no vÃ¡lida para las fuentes.' } 400; return }
            $weekKey = [string]$data.weekKey
            if ($weekKey -notmatch '^\d{4}-\d{2}-\d{2}$') { Send-Json $Context @{ error = 'La semana no es válida.' } 400; return }
            $byWeek = @{}
            $existingWeeks = $script:State.workspace.sources.byWeek
            if ($existingWeeks -is [System.Collections.IDictionary]) { foreach ($key in $existingWeeks.Keys) { $byWeek[$key] = $existingWeeks[$key] } }
            else { foreach ($property in $existingWeeks.PSObject.Properties) { $byWeek[$property.Name] = $property.Value } }
            $value = $data.value
            $currentSources = $byWeek[$weekKey]
            $mergedSources = @{ reports = ''; activities = ''; comments = ''; other = '' }
            if ($currentSources) { foreach ($field in @('reports','activities','comments','other')) { if ($currentSources.PSObject.Properties[$field]) { $mergedSources[$field] = [string]$currentSources.$field } } }
            $sourceChanges = @()
            foreach ($field in @('reports','activities','comments','other')) {
                if ($value.PSObject.Properties[$field]) {
                    $before = [string]$mergedSources[$field]; $after = [string]$value.$field
                    if ($before -cne $after) {
                        $beforeShort = if ($before.Length -gt 180) { $before.Substring(0,180) + '...' } else { $before }
                        $afterShort = if ($after.Length -gt 180) { $after.Substring(0,180) + '...' } else { $after }
                        $sourceChanges += $field + ': ' + $beforeShort + ' -> ' + $afterShort
                    }
                    $mergedSources[$field] = $after
                }
            }
            $byWeek[$weekKey] = [pscustomobject]$mergedSources
            $script:State.workspace.sources = [pscustomobject]@{ byWeek = $byWeek }
            Save-State 'Fuentes actualizadas' ('Semana ' + $weekKey + '. ' + ($sourceChanges -join '; '))
        } else {
            $collection = @($script:State.workspace.PSObject.Properties[$section].Value)
            if ($action -eq 'add') {
                $sourceItem = $data.item
                $fields = if ($section -eq 'workers') { @('name','role','area','contact','deadlines') } elseif ($section -eq 'activities') { @('title','owner','due','done') } else { @('text','link','date') }
                $record = [ordered]@{ id = [Guid]::NewGuid().ToString('N'); createdAt = (Get-Date).ToString('o'); updatedAt = (Get-Date).ToString('o'); createdBy = $script:CurrentActor; updatedBy = $script:CurrentActor }
                foreach ($field in $fields) { if ($sourceItem.PSObject.Properties[$field]) { $record[$field] = $sourceItem.$field } }
                if ($section -eq 'activities' -and -not $record.Contains('done')) { $record.done = $false }
                if ($section -eq 'workers' -and -not $record.Contains('deadlines')) { $record.deadlines = @() }
                $collection += [pscustomobject]$record
                $script:State.workspace.$section = @($collection)
                $recordLabel = if ($record.title) { $record.title } elseif ($record.name) { $record.name } else { $record.text }
                Save-State ($section + ' agregado') ([string]$recordLabel)
            } elseif ($action -in @('update','toggle','delete')) {
                $recordId = [string]$data.id
                $record = @($collection | Where-Object { $_.id -eq $recordId } | Select-Object -First 1)[0]
                if (-not $record) { Send-Json $Context @{ error = 'El registro ya no existe; actualiza la pantalla.' } 409; return }
                if ($action -eq 'delete') {
                    $script:State.workspace.$section = @($collection | Where-Object { $_.id -ne $recordId })
                    $recordLabel = if ($record.title) { $record.title } elseif ($record.name) { $record.name } else { $record.text }
                    Save-State ($section + ' eliminado') ([string]$recordLabel)
                } else {
                    $beforeValues = @{}
                    $fields = if ($section -eq 'workers') { @('name','role','area','contact','deadlines') } elseif ($section -eq 'activities') { @('title','owner','due','done') } else { @('text','link','date') }
                    foreach ($field in $fields) { $beforeValues[$field] = if ($field -eq 'deadlines') { ConvertTo-Json -InputObject @($record.$field) -Depth 8 -Compress } else { [string]$record.$field } }
                    if ($action -eq 'toggle') { $record.done = -not [bool]$record.done }
                    if ($action -eq 'update') {
                        foreach ($field in $fields) { if ($data.item.PSObject.Properties[$field]) { $record.$field = $data.item.$field } }
                    }
                    $record.updatedAt = (Get-Date).ToString('o'); $record.updatedBy = $script:CurrentActor
                    $script:State.workspace.$section = @($collection)
                    $recordLabel = if ($record.title) { $record.title } elseif ($record.name) { $record.name } else { $record.text }
                    $changes = @($fields | Where-Object { $currentValue = if ($_ -eq 'deadlines') { ConvertTo-Json -InputObject @($record.$_) -Depth 8 -Compress } else { [string]$record.$_ }; $currentValue -cne $beforeValues[$_] } | ForEach-Object { $currentValue = if ($_ -eq 'deadlines') { ConvertTo-Json -InputObject @($record.$_) -Depth 8 -Compress } else { [string]$record.$_ }; $_ + ': ' + $beforeValues[$_] + ' -> ' + $currentValue })
                    $detail = [string]$recordLabel
                    if ($changes.Count) { $detail += ' | ' + ($changes -join '; ') }
                    Save-State ($section + ' actualizado') $detail
                }
            } else { Send-Json $Context @{ error = 'AcciÃ³n no vÃ¡lida.' } 400; return }
        }
        Send-Json $Context @{ revision = [int]$script:State.revision; workspace = $script:State.workspace; auditLog = @($script:State.auditLog | Select-Object -Last 100 | Sort-Object at -Descending) }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/project') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        Send-Json $Context $script:State.project
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/logout') {
        $header = $Context.Request.Headers['Authorization']
        if ($header -match '^Bearer (.+)$') { $script:Sessions.Remove($Matches[1]) }
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/me') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        Send-Json $Context @{ email = $user.email; displayName = $user.displayName; role = $user.role; avatar = $user.avatar }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/profile') {
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Inicia sesión como personal autorizado.' } 401; return }
        $data = Read-Json $Context
        $displayName = ([string]$data.name).Trim()
        if ($displayName.Length -lt 2 -or $displayName.Length -gt 80) { Send-Json $Context @{ error = 'Escribe tu nombre completo.' } 400; return }
        $avatar = [string]$data.avatar
        if ($avatar.Length -gt 700000 -or ($avatar -and $avatar -notmatch '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$')) { Send-Json $Context @{ error = 'La imagen no es válida o supera el tamaño permitido.' } 400; return }
        $previousName = [string]$user.displayName
        $user.displayName = $displayName
        $user.avatar = $avatar
        Save-State 'Perfil actualizado' ($previousName + ' -> ' + $displayName + ' (avatar actualizado)')
        Send-Json $Context @{ ok = $true; displayName = $displayName; avatar = $user.avatar }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/invite') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $email -eq 'brandonlasteros31@gmail.com') { Send-Json $Context @{ error = 'Escribe un correo válido del personal.' } 400; return }
        if (@($script:State.users | Where-Object email -eq $email).Count -gt 0) { Send-Json $Context @{ error = 'Ese correo ya tiene acceso.' } 409; return }
        $script:State.allowedEmails = @($script:State.allowedEmails | Where-Object { $_ -ne $email }) + @($email)
        $script:State.invitations = @($script:State.invitations | Where-Object { $_.email -ne $email })
        $code = [Guid]::NewGuid().ToString('N').Substring(0, 12).ToUpperInvariant()
        $script:State.invitations = @($script:State.invitations) + @([pscustomobject]@{ email = $email; code = $code; used = $false; created = (Get-Date).ToString('o') })
        Save-State 'Invitacion creada' $email
        Send-Json $Context @{ email = $email; code = $code }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/people') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        $emails = if ($user.role -eq 'admin') { $script:State.allowedEmails } else { @($script:State.users | Where-Object role -eq 'staff' | ForEach-Object email) }
        $people = @($emails | ForEach-Object {
            $email = $_
            $account = @($script:State.users | Where-Object email -eq $email | Select-Object -First 1)[0]
            [pscustomobject]@{ email = $email; displayName = if ($account -and $account.displayName) { $account.displayName } else { $email }; avatar = if ($account) { $account.avatar } else { '' }; active = [bool]$account; role = if ($account) { $account.role } else { 'Invitación pendiente' } }
        })
        Send-Json $Context $people
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/people/role') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        $newRole = [string]$data.role
        $account = @($script:State.users | Where-Object email -eq $email | Select-Object -First 1)[0]
        if (-not $account -or $newRole -notin @('admin','staff')) { Send-Json $Context @{ error = 'Selecciona un trabajador con cuenta activa y un permiso válido.' } 400; return }
        $actor = Get-User $Context
        if ($newRole -eq 'staff' -and $email -eq [string]$actor.email) { Send-Json $Context @{ error = 'No puedes quitarte tu propio permiso de administrador.' } 400; return }
        if ($newRole -eq 'staff' -and $account.role -eq 'admin' -and @($script:State.users | Where-Object role -eq 'admin').Count -le 1) { Send-Json $Context @{ error = 'Debe quedar al menos un administrador.' } 400; return }
        $previousRole = [string]$account.role
        $account.role = $newRole
        Save-State 'Permiso de cuenta actualizado' ($email + ': ' + $previousRole + ' -> ' + $newRole)
        Send-Json $Context @{ ok = $true; email = $email; role = $newRole }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/people/remove') {
        $admin = Require-Admin $Context
        if (-not $admin) { return }
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { Send-Json $Context @{ error = 'No reconozco el correo del trabajador.' } 400; return }
        if ($email -eq [string]$admin.email) { Send-Json $Context @{ error = 'No puedes retirarte a ti mismo del proyecto.' } 400; return }
        $account = @($script:State.users | Where-Object { ([string]$_.email).ToLowerInvariant() -eq $email } | Select-Object -First 1)[0]
        if ($account -and [string]$account.role -eq 'admin') { Send-Json $Context @{ error = 'No puedes retirar una cuenta administradora desde el equipo de trabajadores.' } 400; return }
        $isAuthorized = @($script:State.allowedEmails | Where-Object { ([string]$_).Trim().ToLowerInvariant() -eq $email }).Count -gt 0
        if (-not $account -and -not $isAuthorized) { Send-Json $Context @{ error = 'Ese trabajador ya no está en el proyecto.' } 404; return }
        $personName = if ($account.displayName) { [string]$account.displayName } else { $email }
        $script:State.users = @($script:State.users | Where-Object { ([string]$_.email).ToLowerInvariant() -ne $email })
        $script:State.allowedEmails = @($script:State.allowedEmails | Where-Object { ([string]$_).Trim().ToLowerInvariant() -ne $email })
        $script:State.invitations = @($script:State.invitations | Where-Object { ([string]$_.email).ToLowerInvariant() -ne $email })
        foreach ($token in @($script:Sessions.Keys)) { if ([string]$script:Sessions[$token] -eq $email) { $script:Sessions.Remove($token) } }
        $previousWorkerCount = @($script:State.workspace.workers).Count
        $matchedWorkerIds = @($script:State.workspace.workers | Where-Object { ([string]$_.contact).Trim().ToLowerInvariant() -eq $email } | ForEach-Object { [string]$_.id })
        if ($matchedWorkerIds.Count -eq 0 -and $personName -ne $email) {
            $matchedWorkerIds = @($script:State.workspace.workers | Where-Object { ([string]$_.name).Trim().ToLowerInvariant() -eq $personName.Trim().ToLowerInvariant() } | Select-Object -First 1 | ForEach-Object { [string]$_.id })
        }
        $remainingWorkers = if ($matchedWorkerIds.Count -gt 0) { @($script:State.workspace.workers | Where-Object { [string]$_.id -notin $matchedWorkerIds }) } else { @($script:State.workspace.workers) }
        $script:State.workspace.workers = $remainingWorkers
        $removedWorkerCount = $previousWorkerCount - @($remainingWorkers).Count
        Save-State 'Trabajador retirado del proyecto' ($personName + ' (' + $email + '); se conservaron sus entregas y archivos.')
        Send-Json $Context @{ ok = $true; email = $email; removedWorkers = $removedWorkerCount }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/submissions') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesion.' } 401; return }
        $items = @($script:State.submissions | Where-Object { $user.role -eq 'admin' -or $_.email -eq $user.email } | Sort-Object created -Descending)
        if ($user.role -ne 'admin') { $items = @($items | ForEach-Object { $visibleItem = $_ | Select-Object *; $visibleItem.review = ''; $visibleItem.reviewed = ''; $visibleItem }) }
        Send-Json $Context $items
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/technical-summary') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesion.' } 401; return }
        $items = @($script:State.submissions | Sort-Object created | ForEach-Object {
            [pscustomobject]@{
                kind = $_.kind; title = $_.title; number = $_.number; documentDate = $_.documentDate
                valuationNumber = $_.valuationNumber; valuationPeriod = $_.valuationPeriod
                plannedProgress = $_.plannedProgress; actualProgress = $_.actualProgress
                conformityCategory = $_.conformityCategory; responsibleEmail = $_.responsibleEmail
                responsibleName = $_.responsibleName; submitterName = $_.submitterName; email = $_.email
                note = $_.note; created = $_.created; status = $_.status
                files = @($_.files | ForEach-Object { [pscustomobject]@{ name = $_.name } })
                review = if ($user.role -eq 'admin') { $_.review } else { '' }
            }
        })
        Send-Json $Context $items
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/backup/download') {
        if (-not (Require-Admin $Context)) { return }
        Add-Type -AssemblyName System.IO.Compression
        $archiveMemory = [System.IO.MemoryStream]::new()
        $archive = [System.IO.Compression.ZipArchive]::new($archiveMemory, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        $fileManifest = [System.Collections.Generic.List[object]]::new()
        try {
            foreach ($item in @($script:State.submissions)) {
                $dateText = if ($item.kind -eq 'valuation') { [string]$item.valuationPeriod } elseif ($item.kind -eq 'conformity') { [string]$item.conformityDate } else { [string]$item.documentDate }
                if (-not $dateText) { $dateText = [string]$item.created }
                $month = if ($dateText -match '^\d{4}-(0[1-9]|1[0-2])') { $dateText.Substring(0,7) } else { 'sin-fecha' }
                $folder = if ($item.kind -eq 'valuation') { 'Valorizaciones' } elseif ($item.kind -eq 'conformity') { 'Conformidades' } else { 'Informes' }
                $title = if ($item.title) { [string]$item.title } elseif ($item.valuationNumber) { [string]$item.valuationNumber } else { 'Entrega' }
                $safeTitle = [System.Text.RegularExpressions.Regex]::Replace($title, '[\x00-\x1F\\/:*?"<>|]', '_').Trim(' ','.')
                if (-not $safeTitle) { $safeTitle = 'Entrega' }
                $shortId = ([string]$item.id).Substring(0,[Math]::Min(8,([string]$item.id).Length))
                foreach ($file in @($item.files)) {
                    $diskPath = Join-Path $script:UploadDir ([string]$file.id + '.bin')
                    $archivePath = ''
                    $included = Test-Path $diskPath
                    if ($included) {
                        $safeFile = [System.Text.RegularExpressions.Regex]::Replace([string]$file.name, '[\x00-\x1F\\/:*?"<>|]', '_').Trim(' ','.')
                        if (-not $safeFile) { $safeFile = 'archivo' }
                        $archivePath = 'archivos/' + $month + '/' + $folder + '/' + $safeTitle + '-' + $shortId + '/' + $safeFile
                        $entry = $archive.CreateEntry($archivePath, [System.IO.Compression.CompressionLevel]::Optimal)
                        $entryStream = $entry.Open()
                        try { $bytes = [System.IO.File]::ReadAllBytes($diskPath); $entryStream.Write($bytes,0,$bytes.Length) } finally { $entryStream.Dispose() }
                    }
                    $fileManifest.Add([pscustomobject]@{ submissionId = [string]$item.id; document = $title; originalFileName = [string]$file.name; included = $included; archivePath = $archivePath })
                }
            }
            $backupUsers = @($script:State.users | ForEach-Object { [pscustomobject]@{ email = [string]$_.email; displayName = [string]$_.displayName; role = [string]$_.role; active = [bool]$_.active; avatar = [string]$_.avatar; draft = $_.draft } })
            $backupData = [pscustomobject]@{
                format = 'Centro de Control de Obra · Respaldo completo'
                exportedAt = (Get-Date).ToString('o')
                revision = $script:State.revision
                project = $script:State.project
                workspace = $script:State.workspace
                authorizedEmails = @($script:State.allowedEmails)
                users = $backupUsers
                submissions = @($script:State.submissions)
                auditLog = @($script:State.auditLog)
                files = @($fileManifest)
            }
            $json = ConvertTo-Json -InputObject $backupData -Depth 40
            $jsonBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
            $jsonEntry = $archive.CreateEntry('respaldo/datos-proyecto.json', [System.IO.Compression.CompressionLevel]::Optimal)
            $jsonStream = $jsonEntry.Open()
            try { $jsonStream.Write($jsonBytes,0,$jsonBytes.Length) } finally { $jsonStream.Dispose() }
            $readme = "Respaldo completo del Centro de Control de Obra.`r`n`r`nEl archivo datos-proyecto.json contiene el proyecto, el equipo, las entregas, el historial y la relación de archivos. La carpeta archivos reúne los documentos adjuntos ordenados por mes. Los usuarios se incluyen sin contraseñas ni claves de acceso.`r`n"
            $readmeBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($readme)
            $readmeEntry = $archive.CreateEntry('LEEME.txt', [System.IO.Compression.CompressionLevel]::Optimal)
            $readmeStream = $readmeEntry.Open()
            try { $readmeStream.Write($readmeBytes,0,$readmeBytes.Length) } finally { $readmeStream.Dispose() }
            $archive.Dispose()
            $archiveBytes = $archiveMemory.ToArray()
            $archiveMemory.Dispose()
            $stamp = (Get-Date).ToString('yyyyMMdd-HHmm')
            $Context.Response.ContentType = 'application/zip'
            $Context.Response.Headers.Add('Content-Disposition', 'attachment; filename="Respaldo-proyecto-' + $stamp + '.zip"')
            $Context.Response.ContentLength64 = $archiveBytes.Length
            $Context.Response.OutputStream.Write($archiveBytes,0,$archiveBytes.Length)
            $Context.Response.Close()
            return
        } catch {
            try { $archive.Dispose() } catch {}
            try { $archiveMemory.Dispose() } catch {}
            Send-Json $Context @{ error = 'No se pudo crear el respaldo completo. Revisa el espacio disponible e inténtalo de nuevo.' } 500
            return
        }
    }
    if ($method -eq 'POST' -and $path -eq '/api/submissions/month-download') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesiÃ³n.' } 401; return }
        $data = Read-Json $Context
        $month = [string]$data.month
        if ($month -notmatch '^(\d{4}-(0[1-9]|1[0-2])|sin-fecha)$') { Send-Json $Context @{ error = 'Selecciona un mes vÃ¡lido.' } 400; return }
        $monthItems = @($script:State.submissions | Where-Object {
            $item = $_
            if ($user.role -ne 'admin' -and [string]$item.email -ne [string]$user.email) { return $false }
            $dateText = if ($item.kind -eq 'valuation') { [string]$item.valuationPeriod } elseif ($item.kind -eq 'conformity') { [string]$item.conformityDate } else { [string]$item.documentDate }
            if (-not $dateText) { $dateText = [string]$item.created }
            $itemMonth = if ($dateText -match '^\d{4}-\d{2}') { $dateText.Substring(0,7) } else { 'sin-fecha' }
            return $itemMonth -eq $month
        } | Sort-Object created)
        if ($monthItems.Count -eq 0) { Send-Json $Context @{ error = 'No hay entregas disponibles para ese mes.' } 404; return }
        Add-Type -AssemblyName System.IO.Compression
        $archiveMemory = [System.IO.MemoryStream]::new()
        $archive = [System.IO.Compression.ZipArchive]::new($archiveMemory, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        $csvRows = [System.Collections.Generic.List[object]]::new()
        $filesIncluded = 0
        foreach ($item in $monthItems) {
            $period = if ($item.kind -eq 'valuation') { [string]$item.valuationPeriod } elseif ($item.kind -eq 'conformity') { [string]$item.conformityDate } else { [string]$item.documentDate }
            if (-not $period) { $period = [string]$item.created }
            $typeLabel = if ($item.kind -eq 'valuation') { 'Valorizacion' } elseif ($item.kind -eq 'conformity') { 'Conformidad' } else { 'Informe' }
            $fileNames = @(); $missingNames = @()
            $groupFolder = if ($item.kind -eq 'valuation') { 'Valorizaciones' } elseif ($item.kind -eq 'conformity') { 'Conformidades' } else { 'Informes' }
            $titleSource = if ($item.title) { [string]$item.title } elseif ($item.valuationNumber) { [string]$item.valuationNumber } else { 'Entrega' }
            $safeTitle = [System.Text.RegularExpressions.Regex]::Replace($titleSource, '[\x00-\x1F\\/:*?"<>|]', '_').Trim(' ','.')
            foreach ($file in @($item.files)) {
                $diskPath = Join-Path $script:UploadDir ([string]$file.id + '.bin')
                if (-not (Test-Path $diskPath)) { $missingNames += [string]$file.name; continue }
                $safeFile = [System.Text.RegularExpressions.Regex]::Replace([string]$file.name, '[\x00-\x1F\\/:*?"<>|]', '_').Trim(' ','.')
                if (-not $safeFile) { $safeFile = 'archivo' }
                $entryName = $groupFolder + '/' + $safeTitle + '-' + ([string]$item.id).Substring(0,[Math]::Min(6,([string]$item.id).Length)) + '/' + $safeFile
                $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
                $entryStream = $entry.Open()
                try { $bytes = [System.IO.File]::ReadAllBytes($diskPath); $entryStream.Write($bytes,0,$bytes.Length) } finally { $entryStream.Dispose() }
                $filesIncluded++; $fileNames += [string]$file.name
            }
            $csvRows.Add([pscustomobject][ordered]@{
                Mes = $month; Tipo = $typeLabel; Documento = [string]$item.title; Numero = [string]$item.valuationNumber
                Periodo = $period; Estado = [string]$item.status; Responsable = [string]$item.responsibleName
                Correo = [string]$item.email; AvanceProgramado = [string]$item.plannedProgress; AvanceEjecutado = [string]$item.actualProgress
                Nota = [string]$item.note; ArchivosIncluidos = ($fileNames -join ' | '); ArchivosNoDisponibles = ($missingNames -join ' | ')
            })
        }
        $csvText = (@($csvRows | ConvertTo-Csv -NoTypeInformation) -join "`r`n")
        $csvBytes = [System.Text.UTF8Encoding]::new($true).GetBytes($csvText)
        $indexEntry = $archive.CreateEntry('Resumen mensual.csv', [System.IO.Compression.CompressionLevel]::Optimal)
        $indexStream = $indexEntry.Open()
        try { $indexStream.Write($csvBytes,0,$csvBytes.Length) } finally { $indexStream.Dispose() }
        $archive.Dispose()
        $archiveBytes = $archiveMemory.ToArray(); $archiveMemory.Dispose()
        $archiveMonth = $month.Replace('-','_')
        $Context.Response.ContentType = 'application/zip'
        $Context.Response.Headers.Add('Content-Disposition', 'attachment; filename="Entregas-' + $archiveMonth + '.zip"')
        $Context.Response.ContentLength64 = $archiveBytes.Length
        $Context.Response.OutputStream.Write($archiveBytes,0,$archiveBytes.Length)
        $Context.Response.Close()
        return
    }    if ($method -eq 'POST' -and $path -eq '/api/submissions') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión con un correo autorizado para enviar.' } 403; return }
        $data = Read-Json $Context
        $files = @($data.files)
        if ([string]::IsNullOrWhiteSpace([string]$data.title) -or $files.Count -lt 1 -or $files.Count -gt 20) { Send-Json $Context @{ error = 'Escribe un asunto y adjunta entre 1 y 20 archivos.' } 400; return }
        $kind = if ([string]$data.kind -eq 'valuation') { 'valuation' } else { 'report' }
        $valuationNumber = ''; $valuationPeriod = ''; $valuationDue = ''; $plannedProgress = $null; $actualProgress = $null
        $conformityCategory = ''; $conformityDate = ''; $conformityDue = ''
        if ($kind -eq 'valuation') {
            if ([string]::IsNullOrWhiteSpace([string]$data.valuationNumber) -or [string]::IsNullOrWhiteSpace([string]$data.valuationPeriod) -or [string]::IsNullOrWhiteSpace([string]$data.valuationDue)) { Send-Json $Context @{ error = 'Completa el número, el período y el plazo de la valorización.' } 400; return }
            try {
                $plannedProgress = [Convert]::ToDouble([string]$data.plannedProgress, [System.Globalization.CultureInfo]::InvariantCulture)
                $actualProgress = [Convert]::ToDouble([string]$data.actualProgress, [System.Globalization.CultureInfo]::InvariantCulture)
            } catch { Send-Json $Context @{ error = 'Escribe ambos avances como porcentajes válidos.' } 400; return }
            if ($plannedProgress -lt 0 -or $plannedProgress -gt 100 -or $actualProgress -lt 0 -or $actualProgress -gt 100) { Send-Json $Context @{ error = 'Los porcentajes deben estar entre 0 y 100.' } 400; return }
            $valuationNumber = ([string]$data.valuationNumber).Trim()
            $valuationPeriod = [string]$data.valuationPeriod
            $valuationDue = [string]$data.valuationDue
        } elseif ([string]$data.kind -eq 'conformity') {
            $kind = 'conformity'
            $validCategories = @('Equipos','Bienes','Servicios')
            if ([string]$data.category -notin $validCategories -or [string]::IsNullOrWhiteSpace([string]$data.conformityDate) -or [string]::IsNullOrWhiteSpace([string]$data.conformityDue)) { Send-Json $Context @{ error = 'Selecciona el tipo de conformidad y completa la fecha y el plazo.' } 400; return }
            $conformityCategory = [string]$data.category
            $conformityDate = [string]$data.conformityDate
            $conformityDue = [string]$data.conformityDue
        }
        $submissionDate = if ($kind -eq 'valuation') { [string]$data.valuationPeriod } elseif ($kind -eq 'conformity') { [string]$data.conformityDate } else { [string]$data.documentDate }
        $allowHistoricalDate = $user.role -eq 'admin' -and [bool]$data.allowHistoricalDate
        if ($submissionDate -notmatch '^\d{4}-\d{2}-\d{2}$') { Send-Json $Context @{ error = 'Completa una fecha válida para la entrega.' } 400; return }
        $projectStart = if ($script:State.project.techWorkStart) { [string]$script:State.project.techWorkStart } else { [string]$script:State.project.techContractStart }
        $projectEnd = if ($script:State.project.techWorkEnd) { [string]$script:State.project.techWorkEnd } else { [string]$script:State.project.techContractEnd }
        $termDays = 0
        [int]::TryParse([string]$script:State.project.techWorkTermDays, [ref]$termDays) | Out-Null
        if (-not $projectEnd -and $projectStart -and $termDays -gt 0) {
            try { $projectEnd = ([datetime]::ParseExact($projectStart, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)).AddDays($termDays - 1).ToString('yyyy-MM-dd') }
            catch { Send-Json $Context @{ error = 'Revisa la fecha de inicio del proyecto.' } 400; return }
        }
        if ($projectStart -and $submissionDate -lt $projectStart) { Send-Json $Context @{ error = 'La fecha de la entrega es anterior al inicio del proyecto.' } 400; return }
        if ($projectEnd -and $submissionDate -gt $projectEnd) { Send-Json $Context @{ error = 'La fecha de la entrega supera el fin o plazo del proyecto.' } 400; return }
        $todayDate = (Get-Date).ToString('yyyy-MM-dd')
        $isPastDate = $submissionDate -lt $todayDate
        if ($submissionDate -gt $todayDate) { Send-Json $Context @{ error = 'No se pueden registrar entregas con fecha futura.' } 400; return }
        if ($isPastDate -and ($user.role -ne 'admin' -or -not $allowHistoricalDate)) { Send-Json $Context @{ error = 'Solo el administrador puede activar la carga histórica para usar fechas anteriores a hoy.' } 400; return }
        if ($isPastDate -and (-not $projectStart -or -not $projectEnd)) { Send-Json $Context @{ error = 'Para cargar fechas anteriores, registra primero el inicio y el fin o plazo del proyecto.' } 400; return }
        $historicalRegistration = $isPastDate
        $allowed = @('.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.jpg','.jpeg','.png','.webp','.txt','.csv')
        $prepared = @(); $total = 0
        foreach ($file in $files) {
            $name = [System.IO.Path]::GetFileName([string]$file.name)
            $extension = [System.IO.Path]::GetExtension($name).ToLowerInvariant()
            if ($extension -notin $allowed) { Send-Json $Context @{ error = "Tipo de archivo no permitido: $name" } 400; return }
            $bytes = [Convert]::FromBase64String([string]$file.data)
            if ($bytes.Length -gt 15000000) { Send-Json $Context @{ error = 'Cada archivo debe pesar menos de 15 MB.' } 400; return }
            $total += $bytes.Length
            $prepared += ,@{ name = $name; bytes = $bytes; size = $bytes.Length; id = [Guid]::NewGuid().ToString('N') }
        }
        if ($total -gt 100000000) { Send-Json $Context @{ error = 'El total de archivos no puede superar 100 MB por envío.' } 400; return }
        $savedFiles = @()
        foreach ($file in $prepared) {
            [System.IO.File]::WriteAllBytes((Join-Path $script:UploadDir ($file.id + '.bin')), $file.bytes)
            $savedFiles += [pscustomobject]@{ id = $file.id; name = $file.name; size = $file.size }
        }
        $responsibleEmail = ([string]$data.responsibleEmail).Trim().ToLowerInvariant()
        if (-not $responsibleEmail) { $responsibleEmail = $user.email }
        $responsibleUser = @($script:State.users | Where-Object { $_.email -eq $responsibleEmail } | Select-Object -First 1)[0]
        if (-not $responsibleUser) { Send-Json $Context @{ error = 'Selecciona un responsable con cuenta activa.' } 400; return }
        $item = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); kind = $kind; email = $user.email; submitterName = if ($user.displayName) { $user.displayName } else { $user.email }; responsibleEmail = $responsibleEmail; responsibleName = if ($responsibleUser.displayName) { $responsibleUser.displayName } else { $responsibleUser.email }; number = if ($kind -eq 'valuation') { $valuationNumber } else { ([string]$data.number).Trim() }; documentDate = if ($kind -eq 'valuation') { $valuationPeriod } elseif ($kind -eq 'conformity') { $conformityDate } else { [string]$data.documentDate }; valuationPeriod = $valuationPeriod; valuationDue = $valuationDue; plannedProgress = $plannedProgress; actualProgress = $actualProgress; conformityCategory = $conformityCategory; conformityDate = $conformityDate; conformityDue = $conformityDue; title = ([string]$data.title).Trim(); note = [string]$data.note; historicalRegistration = $historicalRegistration; created = (Get-Date).ToString('o'); status = 'Pendiente'; review = ''; reviewed = ''; editAuthorized = $false; editRequestStatus = 'none'; editRequestNote = ''; files = $savedFiles }
        $script:State.submissions = @($script:State.submissions) + @($item)
        $auditAction = if ($kind -eq 'conformity') { 'Conformidad cargada' } elseif ($kind -eq 'valuation') { 'Valorizacion cargada' } else { 'Informe cargado' }
        Save-State $auditAction $item.title
        Send-Json $Context @{ ok = $true; id = $item.id }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/review$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/review$').Groups[1].Value
        if (-not (Require-Admin $Context)) { return }
        $item = Find-Submission $submissionId
        if (-not $item) { Send-Json $Context @{ error = 'No encuentro esa entrega.' } 404; return }
        if ([string]$item.status -ne 'Pendiente') { Send-Json $Context @{ error = 'Esta entrega ya fue revisada. Las correcciones autorizadas volverán a quedar pendientes.' } 409; return }
        $data = Read-Json $Context
        if ([string]$data.status -notin @('Aprobada','Observada') -or ([string]$data.status -eq 'Observada' -and [string]::IsNullOrWhiteSpace([string]$data.review))) { Send-Json $Context @{ error = 'Para observar, escribe el motivo.' } 400; return }
        $previousStatus = [string]$item.status
        $item.status = [string]$data.status
        $item.review = ([string]$data.review).Trim()
        $item.reviewed = (Get-Date).ToString('o')
        Save-State 'Entrega revisada' ($item.title + ': ' + $previousStatus + ' -> ' + $item.status + '. ' + [string]$item.review)
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/edit-request$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/edit-request$').Groups[1].Value
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Solo el trabajador que hizo el envío puede solicitar cambios.' } 403; return }
        $item = Find-Submission $submissionId
        if (-not $item -or $item.email -ne $user.email) { Send-Json $Context @{ error = 'No puedes modificar esta entrega.' } 404; return }
        if ($item.editAuthorized) { Send-Json $Context @{ error = 'Ya tienes autorización para corregir esta entrega.' } 409; return }
        if ($item.editRequestStatus -eq 'pending') { Send-Json $Context @{ error = 'Tu solicitud ya está pendiente de revisión.' } 409; return }
        $data = Read-Json $Context
        $reason = ([string]$data.reason).Trim()
        if ($reason.Length -lt 3) { Send-Json $Context @{ error = 'Explica brevemente qué necesitas corregir.' } 400; return }
        $item.editRequestStatus = 'pending'
        $item.editRequestNote = $reason
        Save-State 'Correccion solicitada' ($item.title + ' - ' + $reason)
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/edit-decision$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/edit-decision$').Groups[1].Value
        if (-not (Require-Admin $Context)) { return }
        $item = Find-Submission $submissionId
        if (-not $item) { Send-Json $Context @{ error = 'No encuentro esa entrega.' } 404; return }
        if ($item.editRequestStatus -ne 'pending') { Send-Json $Context @{ error = 'Esta entrega no tiene una solicitud pendiente.' } 409; return }
        $data = Read-Json $Context
        if ([string]$data.status -notin @('authorized','denied')) { Send-Json $Context @{ error = 'Elige autorizar o rechazar la solicitud.' } 400; return }
        $previousDecision = [string]$item.editRequestStatus
        $item.editRequestStatus = [string]$data.status
        $item.editAuthorized = ([string]$data.status -eq 'authorized')
        Save-State 'Solicitud de correccion resuelta' ($item.title + ': ' + $previousDecision + ' -> ' + $item.editRequestStatus)
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/edit$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/edit$').Groups[1].Value
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Solo el trabajador puede corregir su envío.' } 403; return }
        $item = Find-Submission $submissionId
        if (-not $item -or $item.email -ne $user.email) { Send-Json $Context @{ error = 'No puedes modificar esta entrega.' } 404; return }
        if (-not $item.editAuthorized) { Send-Json $Context @{ error = 'El administrador todavía no autorizó la corrección.' } 403; return }
        $data = Read-Json $Context
        $previousTitle = [string]$item.title
        $title = ([string]$data.title).Trim()
        if ($title.Length -lt 1) { Send-Json $Context @{ error = 'Escribe el asunto del informe.' } 400; return }
        $files = @($data.files)
        if ($files.Count -gt 20) { Send-Json $Context @{ error = 'Puedes adjuntar hasta 20 archivos.' } 400; return }
        $allowed = @('.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.jpg','.jpeg','.png','.webp','.txt','.csv')
        $prepared = @(); $total = 0
        foreach ($file in $files) {
            $name = [System.IO.Path]::GetFileName([string]$file.name)
            if ([System.IO.Path]::GetExtension($name).ToLowerInvariant() -notin $allowed) { Send-Json $Context @{ error = "Tipo de archivo no permitido: $name" } 400; return }
            $bytes = [Convert]::FromBase64String([string]$file.data)
            if ($bytes.Length -gt 15000000) { Send-Json $Context @{ error = 'Cada archivo debe pesar menos de 15 MB.' } 400; return }
            $total += $bytes.Length
            $prepared += ,@{ name = $name; bytes = $bytes; size = $bytes.Length; id = [Guid]::NewGuid().ToString('N') }
        }
        if ($total -gt 100000000) { Send-Json $Context @{ error = 'El total de archivos no puede superar 100 MB por envío.' } 400; return }
        $newFiles = @()
        foreach ($file in $prepared) {
            [System.IO.File]::WriteAllBytes((Join-Path $script:UploadDir ($file.id + '.bin')), $file.bytes)
            $newFiles += [pscustomobject]@{ id = $file.id; name = $file.name; size = $file.size }
        }
        if ($newFiles.Count -gt 0) {
            foreach ($oldFile in @($item.files)) { Remove-Item -LiteralPath (Join-Path $script:UploadDir ($oldFile.id + '.bin')) -Force -ErrorAction SilentlyContinue }
            $item.files = $newFiles
        }
        $item.title = $title
        $item.note = [string]$data.note
        $item.status = 'Pendiente'
        $item.review = ''
        $item.reviewed = ''
        $item.editAuthorized = $false
        $item.editRequestStatus = 'none'
        $item.editRequestNote = ''
        Save-State 'Entrega corregida' ($previousTitle + ' -> ' + $item.title)
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/files/([0-9a-f]{32})/delete$')) {
        if (-not (Require-Admin $Context)) { return }
        $match = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/files/([0-9a-f]{32})/delete$')
        $submissionId = $match.Groups[1].Value
        $fileId = $match.Groups[2].Value
        $item = Find-Submission $submissionId
        if (-not $item) { Send-Json $Context @{ error = 'No encuentro esa entrega.' } 404; return }
        $file = @($item.files | Where-Object { [string]$_.id -eq $fileId } | Select-Object -First 1)[0]
        if (-not $file) { Send-Json $Context @{ error = 'No encuentro ese archivo en la entrega.' } 404; return }
        $item.files = @($item.files | Where-Object { [string]$_.id -ne $fileId })
        Save-State 'Archivo adjunto eliminado' ($item.title + ' / ' + [string]$file.name)
        [void](Remove-SubmissionFilesIfUnused @([pscustomobject]@{ files = @($file) }))
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'GET' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/files/([0-9a-f]{32})$')) {
        $fileId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/files/([0-9a-f]{32})$').Groups[1].Value
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        $owner = @($script:State.submissions | Where-Object { @($_.files | Where-Object id -eq $fileId).Count -gt 0 } | Select-Object -First 1)[0]
        if (-not $owner -or ($user.role -ne 'admin' -and $owner.email -ne $user.email)) { Send-Json $Context @{ error = 'No tienes permiso para descargar este archivo.' } 403; return }
        $meta = @($owner.files | Where-Object id -eq $fileId | Select-Object -First 1)[0]
        $diskPath = Join-Path $script:UploadDir ($fileId + '.bin')
        if (-not (Test-Path $diskPath)) { Send-Json $Context @{ error = 'El archivo no está disponible.' } 404; return }
        $bytes = [System.IO.File]::ReadAllBytes($diskPath)
        $safeName = [System.Text.RegularExpressions.Regex]::Replace($meta.name, '[^a-zA-Z0-9._-]', '_')
        $Context.Response.ContentType = 'application/octet-stream'
        $Context.Response.Headers.Add('Content-Disposition', 'attachment; filename="' + $safeName + '"')
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    Send-Json $Context @{ error = 'Acción no disponible.' } 404
}
function Read-TcpContext($Client) {
    $stream = $Client.GetStream()
    $stream.ReadTimeout = 15000
    $headerBuffer = [System.IO.MemoryStream]::new()
    $oneByte = New-Object byte[] 1
    $headerEnd = $false
    while (-not $headerEnd -and $headerBuffer.Length -lt 16384) {
        if ($stream.Read($oneByte, 0, 1) -eq 0) { throw 'Conexión cerrada antes de recibir la solicitud.' }
        $headerBuffer.Write($oneByte, 0, 1)
        $current = $headerBuffer.ToArray()
        $length = $current.Length
        $headerEnd = $length -ge 4 -and $current[$length - 4] -eq 13 -and $current[$length - 3] -eq 10 -and $current[$length - 2] -eq 13 -and $current[$length - 1] -eq 10
    }
    if (-not $headerEnd) { throw 'Los encabezados de la solicitud son demasiado largos.' }
    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBuffer.ToArray())
    $lines = $headerText -split "
"
    $requestParts = $lines[0] -split ' '
    if ($requestParts.Count -lt 2) { throw 'La solicitud del navegador no es válida.' }
    $headers = [System.Collections.Specialized.NameValueCollection]::new()
    foreach ($line in $lines | Select-Object -Skip 1) {
        $colon = $line.IndexOf(':')
        if ($colon -gt 0) { $headers.Add($line.Substring(0, $colon).Trim(), $line.Substring($colon + 1).Trim()) }
    }
    $contentLength = 0
    if ($headers['Content-Length']) { $contentLength = [int]$headers['Content-Length'] }
    if ($contentLength -gt 150000000) { throw 'El envío supera el máximo permitido.' }
    $body = New-Object byte[] $contentLength
    $offset = 0
    while ($offset -lt $contentLength) {
        $read = $stream.Read($body, $offset, $contentLength - $offset)
        if ($read -eq 0) { throw 'El envío del navegador quedó incompleto.' }
        $offset += $read
    }
    $hostName = $headers['Host']
    if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = 'localhost:8765' }
    $url = [Uri]::new('http://' + $hostName + $requestParts[1])
    $request = [pscustomobject]@{
        HttpMethod = $requestParts[0]
        Url = $url
        Headers = $headers
        ContentLength64 = [long]$contentLength
        ContentEncoding = [System.Text.Encoding]::UTF8
        InputStream = [System.IO.MemoryStream]::new($body)
    }
    $response = [pscustomobject]@{
        StatusCode = 200
        ContentType = 'text/plain; charset=utf-8'
        ContentLength64 = [long]0
        Headers = [System.Collections.Specialized.NameValueCollection]::new()
        OutputStream = [System.IO.MemoryStream]::new()
        Closed = $false
    }
    $response | Add-Member -MemberType ScriptMethod -Name Close -Value { $this.Closed = $true }
    return [pscustomobject]@{ Request = $request; Response = $response }
}
function Write-TcpResponse($Client, $Context) {
    $response = $Context.Response
    $body = $response.OutputStream.ToArray()
    $response.ContentLength64 = $body.Length
    $reasons = @{ 200 = 'OK'; 400 = 'Bad Request'; 401 = 'Unauthorized'; 403 = 'Forbidden'; 404 = 'Not Found'; 409 = 'Conflict'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }
    $reason = $reasons[[int]$response.StatusCode]
    if (-not $reason) { $reason = 'OK' }
    $headerText = "HTTP/1.1 $($response.StatusCode) $reason`r`nContent-Type: $($response.ContentType)`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n"
    foreach ($key in $response.Headers.AllKeys) { $headerText += "$key`: $($response.Headers[$key])`r`n" }
    $headerText += "`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $stream = $Client.GetStream()
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}
$bindAddress = [System.Net.IPAddress]::Any
if (-not [string]::IsNullOrWhiteSpace($env:CENTRO_CONTROL_BIND_ADDRESS)) { $bindAddress = [System.Net.IPAddress]::Parse($env:CENTRO_CONTROL_BIND_ADDRESS) }
$listener = [System.Net.Sockets.TcpListener]::new($bindAddress, 8765)
try {
    $listener.Start()
    $networkIP = $null
    try { $networkIP = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1 } catch { $networkIP = $null }
    if (-not $networkIP) {
        if ($env:OS -eq 'Windows_NT') {
            $ipconfigText = (& ipconfig.exe 2>$null) -join "`n"
            $networkIP = [regex]::Matches($ipconfigText, '(?im)IPv4[^:\r\n]*:\s*((?:\d{1,3}\.){3}\d{1,3})') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne '127.0.0.1' -and $_ -notlike '169.254.*' } | Select-Object -First 1
        } else {
            $networkIP = ((& hostname -I 2>$null) -split '\s+' | Where-Object { $_ -match '^(?!127\.)(?!169\.254\.)\d{1,3}(?:\.\d{1,3}){3}$' } | Select-Object -First 1)
        }
    }
    Write-Host 'Centro de control listo en esta computadora: http://localhost:8765'
    if ($networkIP) { Write-Host "Para la otra laptop conectada a la misma red Wi-Fi: http://${networkIP}:8765/" }
    Write-Host 'Deja esta ventana abierta mientras lo usas. Para apagarlo, presiona Ctrl+C.'
    try { Start-Process 'http://localhost:8765/' } catch { Write-Host 'Abre el centro de control manualmente en http://localhost:8765/' }
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $context = $null
        try {
            $context = Read-TcpContext $client
            Handle-Request $context
        }
        catch {
            Write-Host ('Error: ' + $_.Exception.Message)
            if ($context -and -not $context.Response.Closed) {
                try { Send-Json $context @{ error = 'No se pudo completar esa acción. Revisa los datos e inténtalo otra vez.' } 500 } catch { }
            }
        }
        if ($context) { try { Write-TcpResponse $client $context } catch { Write-Host ('Error de respuesta: ' + $_.Exception.Message) } }
        $client.Close()
    }
} finally { $listener.Stop() }
